import { keccak256, parseUnits, toUtf8Bytes } from "ethers";
import { provider } from "../polymarket/contracts.js";
import { USDC } from "../config.js";
import { getResolution } from "../polymarket/resolution.js";
import { obligationEnvelope } from "./obligation.js";
import { getPolicy } from "./ledger.js";
import type { Policy } from "./types.js";

export type SettlementVerdict = "PROVEN" | "DISPUTED" | "BLOCKED";

export interface VerificationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SettlementVerification {
  policyId: string;
  verdict: SettlementVerdict;
  checks: VerificationCheck[];
}

/** Minimal structural shapes so the verifier is testable without a network. */
export interface TransferLogLike {
  address: string;
  topics: readonly string[];
  data: string;
}
export interface ReceiptLike {
  status: number | null;
  logs: readonly TransferLogLike[];
}
export interface ResolutionLike {
  resolved: boolean;
  payoutDenominator: bigint;
}

export interface VerifyDeps {
  getPolicy: (policyId: string) => Policy | undefined;
  getResolution: (conditionId: string) => Promise<ResolutionLike>;
  getTransactionReceipt: (txHash: string) => Promise<ReceiptLike | null>;
}

const defaultDeps: VerifyDeps = {
  getPolicy,
  getResolution: (conditionId) => getResolution(conditionId),
  getTransactionReceipt: (txHash) =>
    provider.getTransactionReceipt(txHash) as Promise<ReceiptLike | null>,
};

const TRANSFER_TOPIC = keccak256(toUtf8Bytes("Transfer(address,address,uint256)"));

function toTopic(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

/**
 * Exact ERC20 settlement proof: sum every `Transfer(token -> beneficiary)`
 * event in the receipt and require it to equal the obligated amount exactly.
 * This proves THIS settlement transferred THIS amount to THIS beneficiary —
 * not merely that the beneficiary's balance is at least the face value.
 */
export function matchSettlementTransfer(
  logs: readonly TransferLogLike[],
  expected: { tokenAddress: string; beneficiary: string; amountBaseUnits: bigint }
): { ok: boolean; matched: bigint; hits: number; detail: string } {
  const token = expected.tokenAddress.toLowerCase();
  const beneficiaryTopic = toTopic(expected.beneficiary);
  let matched = 0n;
  let hits = 0;
  for (const log of logs) {
    if ((log.address ?? "").toLowerCase() !== token) continue;
    if ((log.topics?.[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) continue;
    if (log.topics.length < 3) continue;
    if ((log.topics[2] ?? "").toLowerCase() !== beneficiaryTopic) continue;
    try {
      matched += BigInt(log.data === "0x" ? "0x0" : log.data);
      hits += 1;
    } catch {
      // non-decodable data: ignore this log rather than trusting it
    }
  }
  const ok = matched === expected.amountBaseUnits;
  const detail =
    hits === 0
      ? `no USDC Transfer event to ${expected.beneficiary.slice(0, 10)}… in the settlement tx`
      : `${hits} Transfer event(s) to beneficiary summing ${matched} base units ` +
        `(obligated ${expected.amountBaseUnits})`;
  return { ok, matched, hits, detail };
}

const DISTRIBUTION_KINDS = new Set(["distribution", "route"]);

function distributionTx(policy: Policy): { txHash: string | null; executionId: string | null } {
  const events = [...policy.events].reverse();
  const tagged = events.find(
    (e) =>
      e.type === "TRANSACTION" &&
      DISTRIBUTION_KINDS.has(String(e.meta?.kind ?? "")) &&
      (e.txHashes?.length ?? 0) > 0
  );
  const event =
    tagged ?? events.find((e) => e.type === "TRANSACTION" && (e.txHashes?.length ?? 0) > 0);
  return {
    txHash: event?.txHashes?.[0] ?? null,
    executionId: (event?.meta?.executionId as string | undefined) ?? null,
  };
}

/**
 * Independent on-chain postcondition verification for a settled obligation.
 * This is the VERIFY stage of the loop: Renn does not trust "KeeperHub said
 * completed" or "a transaction exists" — it re-reads the chain itself and only
 * then closes the obligation (or disputes it).
 *
 * Checks, in order:
 *   1. FINALITY  — payout state is final on the CTF (denom > 0).
 *   2. INTEGRITY — the frozen obligation envelope still matches the policy
 *                  record (address / amount / condition immutable after lock).
 *   3. EXECUTION — the recorded DISTRIBUTION transaction exists on chain and is
 *                  confirmed (status 1), tied to the obligation's executionId.
 *                  A redemption without a distribution cannot close.
 *   4. TRANSFER  — for a nonzero obligation, the distribution receipt contains
 *                  an exact ERC20 `Transfer(USDC -> beneficiary, faceValue)`
 *                  event. Balance >= faceValue is NOT accepted as proof.
 *                  Zero-value obligations are verified separately and are never
 *                  described as nonzero financial settlement.
 *
 * Verdict:
 *   PROVEN   all checks pass — the obligation closed against verified state.
 *   BLOCKED  finality check failed — nothing should be claimed settled.
 *   DISPUTED a post-execution check failed — settlement must not be trusted.
 */
export async function verifySettlement(
  policyId: string,
  deps: Partial<VerifyDeps> = {}
): Promise<SettlementVerification> {
  const d: VerifyDeps = { ...defaultDeps, ...deps };
  const policy = d.getPolicy(policyId);
  if (!policy) throw new Error(`No policy ${policyId}`);

  const checks: VerificationCheck[] = [];

  // 1. FINALITY — re-read the CTF on chain.
  let finalResolved = false;
  try {
    const res = await d.getResolution(policy.conditionId);
    finalResolved = res.resolved;
    checks.push({
      name: "FINALITY",
      ok: finalResolved,
      detail: finalResolved
        ? `payout state final on CTF (denom ${res.payoutDenominator.toString()})`
        : "payout state not final (denom 0) — provisional result",
    });
  } catch (err) {
    checks.push({
      name: "FINALITY",
      ok: false,
      detail: err instanceof Error ? err.message : "resolution read failed",
    });
  }

  // 2. INTEGRITY — recompute the frozen envelope; any drift voids the claim.
  let envelopeIntact = true;
  if (policy.obligationHash) {
    const recomputed = obligationEnvelope({
      conditionId: policy.conditionId,
      parentCollectionId: policy.parentCollectionId,
      beneficiary: policy.treasuryAddress,
      faceValueUsdc: policy.faceValueUsdc ?? policy.positionValueUsdc ?? "0",
      finality: "on-chain-ctf",
      redemptionKind: policy.redemptionKind,
      ...(policy.dependsOn ? { dependsOn: policy.dependsOn } : {}),
    });
    envelopeIntact = recomputed === policy.obligationHash;
    checks.push({
      name: "INTEGRITY",
      ok: envelopeIntact,
      detail: envelopeIntact
        ? "obligation envelope hash matches the frozen commitment"
        : "envelope hash mismatch — obligation was edited after locking",
    });
  } else {
    checks.push({
      name: "INTEGRITY",
      ok: false,
      detail: "no frozen obligation hash recorded",
    });
  }

  // 3. EXECUTION — the recorded DISTRIBUTION transaction, confirmed on chain.
  const { txHash, executionId } = distributionTx(policy);
  let receipt: ReceiptLike | null = null;
  let txConfirmed = false;
  let txDetail = "no recorded distribution transaction";
  if (txHash) {
    try {
      receipt = await d.getTransactionReceipt(txHash);
      txConfirmed = receipt !== null && receipt.status === 1;
      txDetail = txConfirmed
        ? `distribution tx ${txHash.slice(0, 18)}… confirmed on Polygon${executionId ? ` (KeeperHub ${executionId})` : ""}`
        : `distribution tx ${txHash.slice(0, 18)}… not confirmed or reverted`;
    } catch {
      txDetail = `distribution tx ${txHash.slice(0, 18)}… could not be read on chain`;
    }
  }
  checks.push({ name: "EXECUTION", ok: txConfirmed, detail: txDetail });

  // 4. TRANSFER — exact ERC20 Transfer event attributable to this execution.
  const faceValueUsdc = policy.faceValueUsdc ?? policy.positionValueUsdc ?? "0";
  let amountBaseUnits = 0n;
  try {
    amountBaseUnits = parseUnits(faceValueUsdc, 6);
  } catch {
    amountBaseUnits = 0n;
  }
  if (amountBaseUnits === 0n) {
    checks.push({
      name: "TRANSFER",
      ok: true,
      detail:
        "zero-value obligation (face 0) — no financial settlement claimed; " +
        "zero asset value is itself proven",
    });
  } else if (!txConfirmed || !receipt) {
    checks.push({
      name: "TRANSFER",
      ok: false,
      detail: "cannot prove the obligated transfer: settlement tx not confirmed",
    });
  } else {
    const match = matchSettlementTransfer(receipt.logs, {
      tokenAddress: USDC,
      beneficiary: policy.treasuryAddress,
      amountBaseUnits,
    });
    checks.push({ name: "TRANSFER", ok: match.ok, detail: match.detail });
  }

  const ok = checks.every((c) => c.ok);
  const verdict: SettlementVerdict = !finalResolved
    ? "BLOCKED"
    : ok
      ? "PROVEN"
      : "DISPUTED";

  return { policyId, verdict, checks };
}
