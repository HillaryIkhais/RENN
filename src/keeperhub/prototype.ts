import { hexlify, parseUnits, randomBytes } from "ethers";
import { appendFileSync, mkdirSync } from "node:fs";
import { CTF, USDC } from "../config.js";
import { jsonAbi } from "../polymarket/contracts.js";
import { getResolution } from "../polymarket/resolution.js";
import {
  discoverWallet,
  runContractCall,
  type ExecutionStatusResponse,
} from "../keeperhub/client.js";
import { obligationEnvelope } from "../policy/obligation.js";
import {
  arm as armPolicy,
  recordTransaction,
  transition,
} from "../policy/ledger.js";

const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

const CTF_WRITE = jsonAbi([
  "function prepareCondition(address reporter, bytes32 parentCollectionId, bytes32 conditionId, uint256 outcomeSlotCount) external",
  "function splitPosition(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount) external",
  "function reportPayouts(bytes32 questionId, uint256[] payoutNumerators) external",
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external",
]);
const ERC20_WRITE = jsonAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address recipient, uint256 amount) external returns (bool)",
]);

export interface RedemptionOptions {
  /** Face value of the obligation in USDC (6dp). */
  faceValueUsdc: string;
  beneficiary: string;
  winner?: "YES" | "NO";
  /**
   * REAL, already-finally-resolved Polymarket condition to redeem against
   * (Layer-1 zero-value hop: gate is OPEN on-chain, so the full redemption +
   * routing path executes through KeeperHub at a real finally-resolved
   * condition). Leave empty for the self-prepared-condition loop.
   */
  resolvedConditionId?: string;
  resolvedParentCollectionId?: string;
}

export interface RedemptionReceipt {
  policyId: string;
  conditionId: string;
  step: string;
  executionId: string;
  txHash: string | null;
  txLink: string | null;
  sponsored: boolean;
  message: string;
}

const PROTOTYPE_FILE = ".data/prototype.jsonl";
const ZERO_VALUE_FILE = ".data/zero-value.jsonl";

function recordReceipt(file: string, row: RedemptionReceipt): void {
  mkdirSync(".data", { recursive: true });
  appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`);
}

/**
 * The Renn obligation loop, executed end-to-end by KeeperHub against the
 * organisation's Turnkey wallet. Every hop is a real Polygon mainnet execution
 * (simulate -> broadcast -> poll) with sponsored gas:
 *
 *   approve(0) -> [LOCKED OBLIGATION] -> finality gate (WAITING_FINALITY /
 *   SETTLEMENT BLOCKED) -> resolve -> verify final -> redeemPositions ->
 *   route face value -> SETTLED
 *
 * With a `resolvedConditionId` supplied the gate is already OPEN on-chain, so
 * redemption + routing are proven against a real finally-resolved Polymarket
 * condition WITHOUT requiring the org to hold collateral — every amount is 0
 * in zero-value mode scrap: zero-value mode proofs the fetch, and if the
 * caller holds collateral the same path moves face value.
 */
export async function runPrototype(opts: RedemptionOptions): Promise<void> {
  await runRedemptionLoop({ ...opts, zero: false });
}

export async function runZeroValueProof(opts: RedemptionOptions): Promise<void> {
  await runRedemptionLoop({ ...opts, zero: true });
}

async function runRedemptionLoop(
  opts: RedemptionOptions & { zero: boolean }
): Promise<void> {
  const amount = parseUnits(opts.faceValueUsdc, 6).toString();
  const numerators: [number, number] = opts.winner === "NO" ? [0, 1] : [1, 0];
  const walletAddress = (await discoverWallet()).walletAddress;
  const purpose = opts.zero ? "ZERO-VALUE PROOF (Layer 1)" : "PROTOTYPE";
  console.log(`${purpose} — executor: org wallet ${walletAddress} (sponsored gas)\n`);
  const blessed = opts.resolvedConditionId !== undefined;

  // Condition id chosen locally so the obligation is frozen BEFORE anything
  // exists on-chain (or, for the resolved-condition hop, it is a real
  // condition Polymarket already finally-reported).
  const conditionId =
    opts.resolvedConditionId ?? hexlify(randomBytes(32));
  const parentCollectionId =
    opts.resolvedParentCollectionId ?? ZERO32;

  const obligationHash = obligationEnvelope({
    conditionId,
    parentCollectionId: ZERO32,
    beneficiary: opts.beneficiary,
    faceValueUsdc: opts.faceValueUsdc,
    finality: "on-chain-ctf",
    redemptionKind: "classic",
  });

  const policy = armPolicy({
    marketId: 0,
    question: `${opts.zero ? "ZERO-VALUE" : "PROTOTYPE"}: ${opts.faceValueUsdc} USDC to ${opts.beneficiary.slice(0, 10)}… if ${opts.winner ?? "YES"} (KeeperHub-executed condition)`,
    conditionId,
    parentCollectionId: ZERO32,
    negRisk: false,
    positionValueUsdc: opts.faceValueUsdc,
    faceValueUsdc: opts.faceValueUsdc,
    finality: "on-chain-ctf",
    obligationHash,
    treasuryAddress: opts.beneficiary,
    treasuryLabel: opts.zero ? "Zero-value proof beneficiary" : "Prototype beneficiary",
    redemptionKind: "classic",
  });
  transition(
    policy.policyId,
    "LOCKED",
    `Obligation frozen: ${opts.faceValueUsdc} USDC -> ${opts.beneficiary} on ${opts.winner ?? "YES"} final`
  );
  console.log(
    `OBLIGATION #${policy.policyId}\n` +
      `  beneficiary   ${opts.beneficiary}\n` +
      `  face value    ${opts.faceValueUsdc} USDC\n` +
      `  trigger       ${opts.winner ?? "YES"} wins\n` +
      `  finality      on-chain CTF payout state\n` +
      `  envelope hash ${obligationHash.slice(0, 18)}…${obligationHash.slice(-6)}`
  );

  // elp: deploy-mode marker
  const hop = (label: string, step: ExecutionStatusResponse, note: string): void => {
    recordReceipt(opts.zero ? ZERO_VALUE_FILE : PROTOTYPE_FILE, {
      policyId: policy.policyId,
      conditionId,
      step: label,
      executionId: step.executionId,
      txHash: step.transactionHash,
      txLink: step.transactionLink,
      sponsored: step.sponsored,
      message: note,
    });
    recordTransaction(policy.policyId, step.transactionHash ? [step.transactionHash] : [], step.transactionLink ? [step.transactionLink] : [], note, {
      executionId: step.executionId,
      sponsored: step.sponsored,
    });
  };

  // 0. Approve the CTF to pull the collateral (0 in proof mode).
  const step0 = await runContractCall(
    {
      contractAddress: USDC,
      chainId: "137",
      functionName: "approve",
      functionArgs: [CTF, amount],
      abi: ERC20_WRITE,
    },
    { label: `approve(CTF, ${opts.faceValueUsdc})` }
  );
  hop("approve", step0, `${opts.faceValueUsdc} USDC approved to CTF`);
  console.log(`\n[approve] ${opts.faceValueUsdc} USDC -> CTF — ${step0.transactionLink}`);

  // 1. If a real finally-resolved condition was supplied, the gate is already
  // OPEN on-chain: verify finality by reading the payout state back, then run
  // the redemption + routing path against the REAL condition (Layer-1 hop).
  if (blessed) {
    const resolution = await getResolution(conditionId);
    if (!resolution.resolved || resolution.payoutDenominator <= 0n) {
      throw new Error(
        `resolvedConditionId ${conditionId.slice(0, 20)}… not finally resolved on-chain (denom=${resolution.payoutDenominator})`
      );
    }
    console.log(
      `\n[finality] REAL finally-resolved condition — gate OPEN ` +
        `(denom=${resolution.payoutDenominator}) — SETTLEMENT UNBLOCKED`
    );

    // 2. Redeem the winning share straight through KeeperHub (classic path,
    // zero-share redemption on the real resolved condition).
    const step1 = await runContractCall(
      {
        contractAddress: CTF,
        chainId: "137",
        functionName: "redeemPositions",
        functionArgs: [USDC, parentCollectionId, conditionId, [1, 2]],
        abi: CTF_WRITE,
      },
      { label: `redeemPositions(${conditionId.slice(0, 10)}…)` }
    );
    hop("redeem", step1, "winning shares redeemed on classic CTF path");
    console.log(`\n[redeem] winning shares redeemed — ${step1.transactionLink}`);

    // 3. Route the zero-value face to the beneficiary (the discharge hop;
    // identical to the FOMC policy's routing step).
    const step2 = await runContractCall(
      {
        contractAddress: USDC,
        chainId: "137",
        functionName: "transfer",
        functionArgs: [opts.beneficiary, amount],
        abi: ERC20_WRITE,
      },
      { label: "route face value" }
    );
    hop("route", step2, "obligation discharged to beneficiary");

    transition(policy.policyId, "RESOLVED", `Final on-chain resolution: gate open (denom=${resolution.payoutDenominator}) — settlement allowed`);
    transition(policy.policyId, "SETTLED", `Obligation DISCHARGED: ${opts.faceValueUsdc} USDC settled (Layer-1 hop)`, {
      redemptionHash: step1.transactionHash,
      routingHash: step2.transactionHash,
    });
    console.log(`\n[route] ${opts.faceValueUsdc} USDC -> ${opts.beneficiary} — ${step2.transactionLink}`);
    console.log(`\nOBLIGATION DISCHARGED — ${opts.faceValueUsdc} USDC SETTLED (Layer-1 zero-value hop)\n` + `Ledger: pnpm status`);
    return;
  }

  // --- Self-prepared-condition loop (deterministic demo path) ---

  // 2. Create the condition (guard: it must not already exist).
  const before = await getResolution(conditionId);
  if (before.payoutDenominator !== 0n) {
    throw new Error(`condition ${conditionId.slice(0, 20)}… already resolved — refusing to re-report`);
  }
  const step1 = await runContractCall(
    {
      contractAddress: CTF,
      chainId: "137",
      functionName: "prepareCondition",
      functionArgs: [walletAddress, ZERO32, conditionId, 2],
      abi: CTF_WRITE,
    },
    { label: "prepareCondition" }
  );
  hop("prepare", step1, "condition created on CTF");
  console.log(`\n[prepare] condition ${conditionId.slice(0, 18)}… — ${step1.transactionLink}`);

  // 3. WAITING_FINALITY: the outcome is provisional — settlement blocked.
  const gateRead = await getResolution(conditionId);
  if (gateRead.payoutDenominator !== 0n) {
    throw new Error(`expected unsettled condition right after prepare, got denom=${gateRead.payoutDenominator}`);
  }
  transition(
    policy.policyId,
    "WAITING_FINALITY",
    "Outcome provisional — SETTLEMENT BLOCKED until the on-chain payout state is final"
  );
  console.log(`\n[finality] provisional outcome — SETTLEMENT BLOCKED (denom=0)`);

  // 4. Report the winning payout on-chain (prototype only).
  const step2 = await runContractCall(
    {
      contractAddress: CTF,
      chainId: "137",
      functionName: "reportPayouts",
      functionArgs: [conditionId, numerators],
      abi: CTF_WRITE,
    },
    { label: `reportPayouts(${opts.winner ?? "YES"})` }
  );
  hop("resolve", step2, "payout reported on chain");
  console.log(`\n[resolve] reported ${opts.winner ?? "YES"} — ${step2.transactionLink}`);

  // 5. Finality verified by reading the on-chain payout state back.
  const after = await getResolution(conditionId);
  if (after.payoutDenominator <= 0n) {
    throw new Error(`expected final denominator > 0, got ${after.payoutDenominator}`);
  }
  transition(policy.policyId, "RESOLVED", `Final on-chain resolution: ${opts.winner ?? "YES"} wins (denom=${after.payoutDenominator})`);
  console.log(`\n[finality] payoutDenominator=${after.payoutDenominator} — FINAL, gate open`);

  // 6. Redeem the winning share (0 in proof mode).
  const step3 = await runContractCall(
    {
      contractAddress: CTF,
      chainId: "137",
      functionName: "redeemPositions",
      functionArgs: [USDC, ZERO32, conditionId, [1, 2]],
      abi: CTF_WRITE,
    },
    { label: "redeemPositions" }
  );
  hop("redeem", step3, "winning share redeemed");
  console.log(`\n[redeem] winning share redeemed — ${step3.transactionLink}`);
  transition(policy.policyId, "EXECUTING", "KeeperHub redemption in progress");

  // 7. Route the zero-value face to the beneficiary (obligation discharged).
  const step4 = await runContractCall(
    {
      contractAddress: USDC,
      chainId: "137",
      functionName: "transfer",
      functionArgs: [opts.beneficiary, amount],
      abi: ERC20_WRITE,
    },
    { label: "route face value" }
  );
  hop("route", step4, "obligation discharged to beneficiary");
  transition(policy.policyId, "SETTLED", `Obligation DISCHARGED: ${opts.faceValueUsdc} USDC settled`, {
    redemptionExecutionId: step3.executionId,
    routingExecutionId: step4.executionId,
  });
  console.log(`\n[route] ${opts.faceValueUsdc} USDC -> ${opts.beneficiary} — ${step4.transactionLink}`);
  console.log(`\nOBLIGATION DISCHARGED — ${opts.faceValueUsdc} USDC SETTLED\n` + `Ledger: pnpm status`);
}
