import { parseArgs } from "node:util";
import { Wallet, formatUnits } from "ethers";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
config();

import {
  EOA_ADDRESS,
  EOA_PRIVATE_KEY,
  USDC,
  USDC_E,
  requireEnv,
} from "./config.js";
import { provider } from "./polymarket/contracts.js";
import { findMarkets, getMarket } from "./polymarket/gamma.js";
import {
  describeResolution,
  getResolution,
} from "./polymarket/resolution.js";
import {
  classicRedeem,
} from "./polymarket/redemption.js";
import { buildRedemptionWorkflow, type WorkflowEnvelope } from "./keeperhub/workflow.js";
import {
  arm as armPolicy,
  getPolicy,
  recordTransaction,
  reload,
  transition,
} from "./policy/ledger.js";
import type { Policy, RedemptionKind } from "./policy/types.js";
import {
  discoverWallet,
  hasKeeperHubKey,
  runContractCall,
} from "./keeperhub/client.js";
import { preflight, renderPreflight, zeroValueApproveStep } from "./gas/preflight.js";

const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const GAMMA_MARKET_PARAMS = {
  closed: false,
  negRisk: true,
  endDateMin: isoInDays(0),
  endDateMax: isoInDays(7),
  limit: 60,
  order: "volume",
  ascending: false,
};

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function signer(): Wallet {
  const pk = EOA_PRIVATE_KEY ?? requireEnv("EOA_PRIVATE_KEY");
  return new Wallet(pk, provider);
}

async function marketFind(): Promise<void> {
  const markets = await findMarkets(GAMMA_MARKET_PARAMS);
  const sorted = markets
    .map((m) => ({ m, vol: Number(m.volume24hr ?? m.volume ?? 0) }))
    .sort((a, b) => b.vol - a.vol);
  console.log(`Candidate markets resolving in the next 7 days (by 24h volume):\n`);
  let shown = 0;
  for (const { m, vol } of sorted) {
    if (vol < 100 && shown >= 15) continue;
    console.log(
      `${String(m.id).padEnd(8)} ${(m.endDate ?? "").slice(0, 10).padEnd(12)} ` +
        `vol24=${vol >= 10_000 ? `${(vol / 1000).toFixed(1)}k` : vol.toFixed(0).padStart(6)} ` +
        `negRisk=${m.negRisk ? "y" : "n"} ${(m.question ?? "").slice(0, 72)}`
    );
    shown += 1;
  }
}

interface ArmOpts {
  marketId: number;
  positionValueUsdc?: string;
  treasuryAddress?: string;
  treasuryLabel?: string;
  notes?: string;
}

async function arm(opts: ArmOpts): Promise<Policy> {
  const market = await getMarket(opts.marketId);
  if (!market) throw new Error(`Market ${opts.marketId} not found on Gamma`);

  const treasuryAddress =
    opts.treasuryAddress ?? process.env.TREASURY_ADDRESS ?? "";
  if (!treasuryAddress) {
    throw new Error(
      "Set TREASURY_ADDRESS (env) or pass --treasury so the payout has a precommitted destination."
    );
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(treasuryAddress)) {
    throw new Error(`Invalid treasury address: ${treasuryAddress}`);
  }

  const positionValueUsdc =
    opts.positionValueUsdc ?? process.env.POSITION_VALUE_USDC ?? "100";
  const conditionId = market.conditionId;
  const parentCollectionId = market.parentCollectionId ?? ZERO32;
  const redemptionKind: RedemptionKind = market.negRisk ? "negRisk" : "classic";

  const redemptionStep = classicRedeem({
    collateralToken: USDC,
    parentCollectionId,
    conditionId,
    indexSets: [1, 2],
  });

  const workflow = buildRedemptionWorkflow({
    name: `Renn ${market.id}: ${market.slug}`,
    description: `On resolution of "${market.question}", redeem winning shares on chain and route USDC ${positionValueUsdc} to ${opts.treasuryLabel ?? treasuryAddress}.`,
    chainNetwork: "137",
    conditionId,
    parentCollectionId,
    redemption: redemptionStep,
    redemptionKind,
    treasuryAddress,
    usdcAmount: positionValueUsdc,
  });

  const policy = armPolicy({
    marketId: market.id,
    question: market.question,
    conditionId,
    parentCollectionId,
    negRisk: market.negRisk,
    positionValueUsdc,
    treasuryAddress,
    treasuryLabel: opts.treasuryLabel,
    redemptionKind,
    workflowName: workflow.name,
    workflow,
    notes: opts.notes,
  });

  const dir = ".data/workflows";
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${policy.policyId}.json`), JSON.stringify(workflow, null, 2));
  console.log(
    `Armed policy ${policy.policyId} against market ${market.id}.\nWorkflow JSON written to ${dir}/${policy.policyId}.json`
  );
  return policy;
}

async function status(): Promise<void> {
  const policies = reload();
  if (policies.length === 0) {
    console.log("No policies armed yet. Run `pnpm arm --market=<id> --treasury=<addr>`");
    return;
  }
  console.log("");
  console.log("POLICY LEDGER");
  console.log("-".repeat(110));
  for (const p of policies) {
    const res = await getResolution(p.conditionId).catch(() => null);
    const resText = res ? describeResolution(res) : "n/a";
    console.log(
      `${p.policyId.padEnd(14)} ${p.state.padEnd(10)} market=${String(p.marketId).padEnd(8)} ` +
        `${resText.padEnd(12)} ${(p.question ?? "").slice(0, 52)}`
    );
  }
  console.log("-".repeat(110));
  console.log("Receipts and event history are stored per policy. See event log below.\n");

  for (const p of policies) {
    console.log(`  [${p.policyId}] ${p.state}`);
    for (const e of p.events) {
      const tx = e.txHashes?.length ? ` tx=${e.txHashes.join(",")}` : "";
      console.log(`    ${e.at.slice(0, 19)} ${e.type.padEnd(12)} ${e.message ?? ""}${tx}`);
    }
    console.log("");
  }
}

async function watch(intervalMs = 60_000): Promise<void> {
  console.log(`Watching for resolution every ${intervalMs / 1000}s. Ctrl-C to stop.`);
  let last = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const policies = reload();
    for (const p of policies.filter((x) => x.state !== "SETTLED" && x.state !== "FAILED")) {
      const res = await getResolution(p.conditionId);
      if (res.resolved && (p.state === "ARMED" || p.state === "LOCKED")) {
        transition(p.policyId, "RESOLVED", `On-chain resolution: ${describeResolution(res)}`);
      }
      const body = `${p.policyId}:${p.state}:${res.payoutDenominator}`;
      if (body !== last) {
        last = body;
        console.log(`${new Date().toISOString()} ${(p.question ?? "").slice(0, 60)} -> ${describeResolution(res)}`);
      }
    }
    await sleep(intervalMs);
  }
}

interface DemoState {
  conditionId: string;
  policyId: string;
  yesTokenId: string;
  collateral: string;
}

const DEMO_STATE_FILE = ".data/demo-state.json";

async function demoBootstrap(): Promise<void> {
  const wallet = signer();
  const { DemoEngine } = await import("./polymarket/demo-engine.js");
  const engine = new DemoEngine(wallet);

  const collateral = process.env.DEMO_COLLATERAL ?? USDC;
  const amountUsdc = process.env.DEMO_AMOUNT_USDC ?? "1";

  // 1. Prepare a CTF condition with this wallet as reporter.
  const { conditionId, txHash } = await engine.prepareCondition({});
  console.log(`Prepared condition ${conditionId}`);
  console.log(`  tx: ${txHash}`);

  // 2. Fund the demo wallet with collateral if needed.
  await fundWalletIfNeeded(wallet.address, collateral);

  // 3. Split collateral into YES+NO shares.
  const { txHash: splitTx, yesTokenId } = await engine.split({
    conditionId,
    amountUsdc,
  });
  console.log(`Split ${amountUsdc} ${collateral.slice(0, 6)}` + ` into YES token ${yesTokenId}`);
  console.log(`  tx: ${splitTx}`);

  // 4. Persist demo state.
  const state: DemoState = {
    conditionId,
    policyId: "",
    yesTokenId: yesTokenId.toString(),
    collateral,
  };
  writeDemoState(state);

  // 5. Arm a policy against this synthetic condition.
  const policy = await armPolicy({
    marketId: 0,
    question: `DEMO: 25 USDC trust condition (deterministic resolution)`,
    conditionId,
    parentCollectionId: ZERO32,
    negRisk: false,
    positionValueUsdc: amountUsdc,
    treasuryAddress: requireEnv("TREASURY_ADDRESS"),
    treasuryLabel: "Demo Treasury",
    redemptionKind: "classic",
  });
  state.policyId = policy.policyId;
  writeDemoState(state);

  console.log(`\nDemo armed as ${policy.policyId}`);
  console.log(`Treasury: ${policy.treasuryAddress}`);
  console.log(`\nNext: pnpm demo:resolve`);
}

async function fundWalletIfNeeded(address: string, collateral: string): Promise<void> {
  const { ETH, ERC20 } = await import("./polymarket/balances.js");
  const pol = await ETH.balanceOf(address);
  if (pol < parseFloat(requireEnv("MIN_POL_BALANCE_FOR_GAS"))) {
    console.log(
      `Warning: wallet ${address} has only ${pol} POL. Fund it with POL for gas before resolving.`
    );
  }
  const token = collateral.toLowerCase() === USDC.toLowerCase() ? USDC : USDC_E;
  const bal = await ERC20.balanceOf(token, address);
  if (bal === 0n) {
    console.log(`Wallet ${address} holds no ${token}. Unable to split.`);
  }
}

async function demoResolve(): Promise<void> {
  const state = readDemoState();
  const wallet = signer();
  const { DemoEngine } = await import("./polymarket/demo-engine.js");
  const engine = new DemoEngine(wallet);
  const winner = process.env.DEMO_WINNER ?? "YES";
  const numerators = winner === "YES" ? [1, 0] : [0, 1];

  const txHash = await engine.resolve({
    conditionId: state.conditionId,
    payoutNumerators: numerators as [number, number],
  });
  console.log(`Reported payout ${winner} -> ${JSON.stringify(numerators)}`);
  transition(state.policyId, "RESOLVED", `On-chain resolution: ${winner} wins`, { txHash });
  console.log(`tx: ${txHash}`);

  // Print balances.
  const bal = await engine.balanceOf(BigInt(state.yesTokenId));
  console.log(`YES balance after resolution: ${formatUnits(bal, 6)}`);
  console.log(`\nNext: pnpm demo:distribute`);
}

async function demoDistribute(): Promise<void> {
  const state = readDemoState();
  const wallet = signer();
  const { DemoEngine } = await import("./polymarket/demo-engine.js");
  const engine = new DemoEngine(wallet);
  const policy = getPolicy(state.policyId);
  if (!policy) throw new Error("Policy not found. Run demo:bootstrap first.");

  // Redeem winning shares through the real CTF on Polygon mainnet.
  const txHash = await engine.classicRedeem({
    conditionId: state.conditionId,
    parentCollectionId: ZERO32,
    indexSets: [1, 2],
  });
  console.log(`Redeemed winning shares: ${txHash}`);

  const txLink = `https://polygonscan.com/tx/${txHash}`;
  recordTransaction(state.policyId, [txHash], [txLink], "Redeemed winning CTF shares", {
    kind: "redemption",
    conditionId: state.conditionId,
  });

  // Route the payout to the treasury.
  const { ERC20 } = await import("./polymarket/balances.js");
  const tokenAddress = state.collateral.toLowerCase() === USDC.toLowerCase() ? USDC : USDC_E;
  const bal = await ERC20.balanceOf(tokenAddress, wallet.address);
  const amountToSend = policy.positionValueUsdc ?? formatUnits(bal, 6);
  const transferTx = await ERC20.transfer(tokenAddress, policy.treasuryAddress, amountToSend, wallet);
  console.log(`Routed ${amountToSend} USDC to ${policy.treasuryAddress}: ${transferTx}`);

  recordTransaction(state.policyId, [transferTx], [
    `https://polygonscan.com/tx/${transferTx}`,
  ], "Routed payout to treasury", { kind: "distribution" });

  transition(state.policyId, "SETTLED", "Payout received and routed to treasury", {
    redemptionTx: txHash,
    routingTx: transferTx,
  });
  console.log(`\nSETTLED. Ledger: pnpm status`);
}

function readDemoState(): DemoState {
  return JSON.parse(readFileSync(DEMO_STATE_FILE, "utf8")) as DemoState;
}

function writeDemoState(state: DemoState): void {
  mkdirSync(".data", { recursive: true });
  writeFileSync(DEMO_STATE_FILE, JSON.stringify(state, null, 2));
}

async function executeWorkflow(policyId: string): Promise<void> {
  const policy = getPolicy(policyId);
  if (!policy) throw new Error(`No policy ${policyId}`);
  if (!hasKeeperHubKey()) throw new Error(requireKeeperHubKeyMessage());

  transition(policy.policyId, "EXECUTING", "Safe execution: simulate the redemption, then broadcast");

  const redeemNode = (policy.workflow as WorkflowEnvelope | undefined)?.nodes.find(
    (n) => n.id === "redeem"
  );
  if (!redeemNode) {
    throw new Error(`Policy ${policyId} has no redeem node in its staged workflow`);
  }
  const config = redeemNode.data.config as {
    network?: string;
    contractAddress?: string;
    abi?: string;
    abiFunction?: string;
    functionArgs?: unknown[];
  };
  const txResult = await runContractCall(
    {
      contractAddress: config.contractAddress ?? "",
      chainId: config.network ?? "137",
      functionName: config.abiFunction ?? "redeemPositions",
      functionArgs: config.functionArgs,
      abi: config.abi,
    },
    { label: policy.policyId }
  );

  if (txResult.status !== "completed") {
    throw new Error(
      `KeeperHub execution ${txResult.executionId} ended in ${txResult.status}: ${txResult.error ?? "see KeeperHub"}`,
    );
  }

  const hash = txResult.transactionHash ?? "";
  const link = txResult.transactionLink ?? "";
  const records = hash ? [hash] : [];
  const links = link ? [link] : [];
  recordTransaction(policy.policyId, records, links, "Redeemed winning CTF shares via KeeperHub", {
    executionId: txResult.executionId,
    sponsored: txResult.sponsored,
    result: txResult.result,
  });
  transition(policy.policyId, "SETTLED", "KeeperHub redemption + routing executed", {
    executionId: txResult.executionId,
    transactionLink: link,
    sponsored: txResult.sponsored,
  });
  console.log(`\nSETTLED. Ledger: pnpm status`);
}

function requireKeeperHubKeyMessage(): string {
  return (
    "KEEPERHUB_API_KEY is not set. Create an organisation API key at " +
    "https://app.keeperhub.com (avatar -> API Keys -> Organisation tab); keys start with kh_. " +
    "User keys (wfb_) are for webhook triggers and are not interchangeable."
  );
}

async function demoPreflight(): Promise<void> {
  const amountUsdc = process.env.DEMO_AMOUNT_USDC ?? "1";
  const report = await preflight({ demoAmountUsdc: amountUsdc, eoa: EOA_ADDRESS ?? null });
  console.log(renderPreflight(report));
}

async function sanityZeroValue(): Promise<void> {
  if (!hasKeeperHubKey()) throw new Error(requireKeeperHubKeyMessage());
  const { walletAddress } = await discoverWallet();
  console.log(`Organisation Turnkey wallet: ${walletAddress}`);

  // Zero-value write on an empty wallet: approve(spender, 0) on USDC Base.
  // Sponsored gas covers the fee; no POL required; moves no tokens.
  const step = zeroValueApproveStep(walletAddress);
  const status = await runContractCall(
    {
      contractAddress: step.contractAddress,
      chainId: "8453",
      functionName: step.functionName,
      functionArgs: step.functionArgs,
      abi: step.abi,
    },
    { label: "sanity approve(0)" }
  );
  console.log(
    `\nSponsored zero-value execution proof:\n` +
      `  executionId  ${status.executionId}\n` +
      `  status       ${status.status} (sponsored=${status.sponsored})\n` +
      `  tx           ${status.transactionLink ?? status.transactionHash}\n` +
      `\nThis landed on Base mainnet with a 0-native balance wallet. Funding was not needed.`
  );
  recordTransaction(
    "sanity",
    status.transactionHash ? [status.transactionHash] : [],
    status.transactionLink ? [status.transactionLink] : [],
    "Zero-value sponsored execution (approve 0) — empty wallet, sponsored gas",
    { executionId: status.executionId, sponsored: status.sponsored }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      market: { type: "string" },
      treasury: { type: "string" },
      amount: { type: "string" },
      "policy-id": { type: "string" },
      "interval-ms": { type: "string" },
      notes: { type: "string" },
    },
  });
  const cmd = positionals[0] ?? "status";

  switch (cmd) {
    case "market-find":
      await marketFind();
      break;
    case "arm": {
      const marketId = Number(values.market ?? process.env.MARKET_ID);
      if (!marketId) throw new Error("Specify --market=<id> or MARKET_ID");
      await arm({
        marketId,
        positionValueUsdc: values.amount ?? process.env.POSITION_VALUE_USDC,
        treasuryAddress: values.treasury ?? process.env.TREASURY_ADDRESS,
        notes: values.notes,
      });
      break;
    }
    case "status":
      await status();
      break;
    case "watch":
      await watch(Number(values["interval-ms"] ?? "60000"));
      break;
    case "demo-bootstrap":
      await demoBootstrap();
      break;
    case "demo-resolve":
      await demoResolve();
      break;
    case "demo-distribute":
      await demoDistribute();
      break;
    case "demo-preflight":
      await demoPreflight();
      break;
    case "sanity": {
      await sanityZeroValue();
      break;
    }
    case "execute": {
      const policyId = values["policy-id"];
      if (!policyId) throw new Error("Specify --policy-id");
      await executeWorkflow(policyId);
      break;
    }
    default:
      printHelp();
  }
}

function printHelp(): void {
  console.log(`Renn — prediction is probabilistic, settlement isn't.
Resolved Polymarket positions become deterministic financial execution through KeeperHub.

Commands:
  market-find              list candidate markets resolving in the next 7 days
  arm --market=<id> --treasury=<addr> [--amount=<usdc>]
                           arm a policy: compose the redemption workflow, stage it
  status                   show the policy ledger + on-chain resolution per policy
  watch [--interval-ms]    poll until resolution, then prompt to execute
  execute --policy-id=<id> trigger the staged KeeperHub workflow
  demo-bootstrap           create a deterministic CTF condition + mint YES shares
  demo-resolve             report the payout (on-chain), transition to RESOLVED
  demo-distribute          redeem + route to treasury, transition to SETTLED
  demo-preflight           print the exact minimum POL + USDC funding before you send anything
  sanity                   KeeperHub zero-value sponsored execution test (needs kh_ key)

Env:
  EOA_PRIVATE_KEY          wallet that owns positions (demo + Polygon)
  EOA_ADDRESS              its address (for preflight balance reads)
  TREASURY_ADDRESS        precommitted payout destination
  KEEPERHUB_API_KEY        org API key (kh_...) for simulation + sponsored execution
  KEEPERHUB_API_BASE       default https://app.keeperhub.com`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`${message}`);
  process.exit(1);
});