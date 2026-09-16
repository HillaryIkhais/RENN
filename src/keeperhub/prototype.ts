import { Contract, formatUnits, hexlify, parseUnits, randomBytes } from "ethers";
import { appendFileSync, mkdirSync } from "node:fs";
import { CTF, USDC } from "../config.js";
import { CTF_ABI, jsonAbi, provider } from "../polymarket/contracts.js";
import {
  computeCollectionId,
  computePositionId,
  getResolution,
} from "../polymarket/resolution.js";
import { discoverWallet, runContractCall } from "../keeperhub/client.js";
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

export interface PrototypeOptions {
  faceValueUsdc: string;
  beneficiary: string;
  winner?: "YES" | "NO";
}

export interface PrototypeReceipt {
  policyId: string;
  conditionId: string;
  executionId: string;
  step: string;
  txHash: string | null;
  txLink: string | null;
  sponsored: boolean;
  message: string;
}

const PROTOTYPE_FILE = ".data/prototype.jsonl";

function recordReceipt(row: PrototypeReceipt): void {
  mkdirSync(".data", { recursive: true });
  appendFileSync(PROTOTYPE_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`);
}

/**
 * Renn prototype loop, executed end-to-end by KeeperHub against the
 * organisation's Turnkey wallet: create a CTF condition, split USDC into
 * outcome shares, resolve it, WAIT through the finality gate, redeem the
 * winning share, and route the face value to the beneficiary. Every hop is a
 * real sponsored Polygon mainnet execution (simulate -> broadcast -> poll).
 *
 * The only external input is ~faceValueUsdc USDC in the org wallet; gas is
 * sponsored, so nothing else is required.
 */
export async function runPrototype(opts: PrototypeOptions): Promise<void> {
  const amount = parseUnits(opts.faceValueUsdc, 6).toString();
  const numerators: [number, number] = opts.winner === "NO" ? [0, 1] : [1, 0];

  const { walletAddress } = await discoverWallet();
  console.log(`Prototype executor: org wallet ${walletAddress} (sponsored gas)\n`);

  // 0. The condition id is chosen locally, so the obligation can be frozen
  // against it BEFORE anything exists on-chain.
  const conditionId = hexlify(randomBytes(32));
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
    question: `PROTOTYPE: ${opts.faceValueUsdc} USDC to ${opts.beneficiary.slice(0, 10)}… if ${opts.winner ?? "YES"} (KeeperHub-executed condition)`,
    conditionId,
    parentCollectionId: ZERO32,
    negRisk: false,
    positionValueUsdc: opts.faceValueUsdc,
    faceValueUsdc: opts.faceValueUsdc,
    finality: "on-chain-ctf",
    obligationHash,
    treasuryAddress: opts.beneficiary,
    treasuryLabel: "Prototype beneficiary",
    redemptionKind: "classic",
  });
  transition(
    policy.policyId,
    "LOCKED",
    `Obligation frozen: ${opts.faceValueUsdc} USDC -> ${opts.beneficiary} on ${opts.winner ?? "YES"} final`,
    { obligationHash }
  );
  console.log(
    `OBLIGATION #${policy.policyId}\n` +
      `  beneficiary   ${opts.beneficiary}\n` +
      `  face value    ${opts.faceValueUsdc} USDC\n` +
      `  trigger       ${opts.winner ?? "YES"} wins\n` +
      `  finality      on-chain CTF payout state\n` +
      `  envelope hash ${obligationHash.slice(0, 18)}…${obligationHash.slice(-6)}\n`
  );

  const rec = (step: string, status: { executionId: string; transactionHash: string | null; transactionLink: string | null; sponsored: boolean }, message: string): void => {
    recordReceipt({
      policyId: policy.policyId,
      conditionId,
      step,
      executionId: status.executionId,
      txHash: status.transactionHash,
      txLink: status.transactionLink,
      sponsored: status.sponsored,
      message,
    });
  };

  // 1. Approve the CTF to pull the collateral out of the org wallet.
  const step1 = await runContractCall(
    {
      contractAddress: USDC,
      chainId: "137",
      functionName: "approve",
      functionArgs: [CTF, amount],
      abi: ERC20_WRITE,
    },
    { label: `approve(CTF, ${opts.faceValueUsdc})` }
  );
  rec("approve", step1, "collateral approved to CTF");
  console.log(`\n[approve] ${opts.faceValueUsdc} USDC -> CTF — ${step1.transactionLink}`);

  // 2. Create the condition (org wallet is the reporter).
  const step2 = await runContractCall(
    {
      contractAddress: CTF,
      chainId: "137",
      functionName: "prepareCondition",
      functionArgs: [walletAddress, ZERO32, conditionId, 2],
      abi: CTF_WRITE,
    },
    { label: "prepareCondition" }
  );
  rec("prepare", step2, "condition created on CTF");
  console.log(`\n[prepare] condition ${conditionId.slice(0, 18)}… — ${step2.transactionLink}`);

  // 3. Split the collateral into YES+NO shares.
  const step3 = await runContractCall(
    {
      contractAddress: CTF,
      chainId: "137",
      functionName: "splitPosition",
      functionArgs: [USDC, ZERO32, conditionId, [1, 2], amount],
      abi: CTF_WRITE,
    },
    { label: `splitPosition(${opts.faceValueUsdc})` }
  );
  rec("split", step3, "USDC split into YES+NO shares");
  console.log(`\n[split] minted YES+NO — ${step3.transactionLink}`);

  const yesCollection = await computeCollectionId(ZERO32, conditionId, 1);
  const yesTokenId = await computePositionId(USDC, yesCollection);
  const ctf = new Contract(CTF, CTF_ABI, provider);
  const yesBal = (await ctf.balanceOf(walletAddress, yesTokenId)) as bigint;
  console.log(`        YES position held by org wallet: ${formatUnits(yesBal, 6)} USDC-worth`);

  // 4. Provisional state: settlement is blocked until on-chain finality.
  const before = await getResolution(conditionId);
  if (before.payoutDenominator !== 0n) {
    throw new Error(`unexpected: condition already resolved (denom=${before.payoutDenominator})`);
  }
  transition(
    policy.policyId,
    "WAITING_FINALITY",
    "Outcome proposed — settlement BLOCKED until on-chain payout state is final"
  );
  console.log("\n[finality] outcome proposed/waiting — SETTLEMENT BLOCKED (denominator=0)");

  // 5. Report the winning payout on-chain (reporter = org wallet).
  const step5 = await runContractCall(
    {
      contractAddress: CTF,
      chainId: "137",
      functionName: "reportPayouts",
      functionArgs: [conditionId, numerators],
      abi: CTF_WRITE,
    },
    { label: `reportPayouts(${opts.winner ?? "YES"})` }
  );
  rec("resolve", step5, "payout reported on-chain");
  console.log(`\n[resolve] reported ${opts.winner ?? "YES"} — ${step5.transactionLink}`);

  // 6. Finality verified by reading the on-chain payout state back.
  const after = await getResolution(conditionId);
  if (after.payoutDenominator <= 0n) {
    throw new Error(`expected final denominator > 0, got ${after.payoutDenominator}`);
  }
  transition(
    policy.policyId,
    "RESOLVED",
    `Final on-chain resolution: ${opts.winner ?? "YES"} wins (denom=${after.payoutDenominator})`,
    { payoutDenominator: after.payoutDenominator.toString() }
  );
  console.log(`\n[finality] payoutDenominator=${after.payoutDenominator.toString()} — FINAL, gate open`);

  // 7. Redeem the winning share.
  transition(policy.policyId, "EXECUTING", "KeeperHub redemption: simulating then broadcasting");
  const step7 = await runContractCall(
    {
      contractAddress: CTF,
      chainId: "137",
      functionName: "redeemPositions",
      functionArgs: [USDC, ZERO32, conditionId, [1, 2]],
      abi: CTF_WRITE,
    },
    { label: "redeemPositions" }
  );
  rec("redeem", step7, "winning share redeemed");
  recordTransaction(policy.policyId, step7.transactionHash ? [step7.transactionHash] : [], step7.transactionLink ? [step7.transactionLink] : [], "Redeemed winning CTF shares via KeeperHub", {
    executionId: step7.executionId,
    sponsored: step7.sponsored,
  });
  console.log(`\n[redeem] winning share redeemed — ${step7.transactionLink}`);

  // 8. Route the face value to the beneficiary (obligation discharged).
  const step8 = await runContractCall(
    {
      contractAddress: USDC,
      chainId: "137",
      functionName: "transfer",
      functionArgs: [opts.beneficiary, amount],
      abi: ERC20_WRITE,
    },
    { label: `transfer(${opts.faceValueUsdc})` }
  );
  rec("route", step8, "obligation discharged to beneficiary");
  recordTransaction(policy.policyId, step8.transactionHash ? [step8.transactionHash] : [], step8.transactionLink ? [step8.transactionLink] : [], "Obligation discharged: face value routed to beneficiary", {
    executionId: step8.executionId,
    sponsored: step8.sponsored,
  });
  transition(
    policy.policyId,
    "SETTLED",
    `Obligation DISCHARGED: ${opts.faceValueUsdc} USDC settled`,
    { obligationHash, redemptionExecutionId: step7.executionId, routingExecutionId: step8.executionId }
  );
  console.log(`\n[route] ${opts.faceValueUsdc} USDC -> ${opts.beneficiary} — ${step8.transactionLink}`);
  console.log(
    `\nOBLIGATION DISCHARGED — ${opts.faceValueUsdc} USDC SETTLED\n` +
      `Ledger: pnpm status`
  );
}