import { keccak256, toUtf8Bytes } from "ethers";
import { USDC } from "../config.js";
import { recordProof } from "./ledger.js";
import type { Policy, SettlementProof } from "./types.js";

/**
 * Settlement proof: the authorization object.
 *
 * When an obligation closes as PROVEN_SETTLED, the independent verification
 * result is persisted as an immutable proof record. A chained obligation
 * unlocks by referencing THIS proof (and re-checking it against on-chain
 * state) — it never merely trusts `state === SETTLED`. This is what turns a
 * settlement into executable financial state for the next obligation.
 */

type ProofPayload = Omit<SettlementProof, "verificationId">;

function canonical(p: ProofPayload): string {
  return JSON.stringify({
    policyId: p.policyId,
    settlementTxHash: p.settlementTxHash.toLowerCase(),
    beneficiary: p.beneficiary.toLowerCase(),
    amountUsdc: p.amountUsdc,
    tokenAddress: p.tokenAddress.toLowerCase(),
    conditionId: p.conditionId.toLowerCase(),
    obligationHash: p.obligationHash.toLowerCase(),
    executionId: p.executionId ?? null,
    verifiedAt: p.verifiedAt,
  });
}

/** keccak256 of the canonical proof payload. Any field change breaks the id. */
export function computeVerificationId(payload: ProofPayload): string {
  return keccak256(toUtf8Bytes(canonical(payload)));
}

export function buildSettlementProof(payload: ProofPayload): SettlementProof {
  return { ...payload, verificationId: computeVerificationId(payload) };
}

/**
 * A proof is only meaningful if it (a) has an intact verification id, and
 * (b) binds the exact obligation it claims to discharge. A proof minted for a
 * different beneficiary, amount, condition, or token is rejected.
 */
export function validateSettlementProof(
  proof: SettlementProof | undefined,
  obligation: Policy
): { ok: boolean; reason?: string } {
  if (!proof) {
    return { ok: false, reason: "no settlement proof persisted" };
  }
  if (proof.policyId !== obligation.policyId) {
    return { ok: false, reason: `proof is for ${proof.policyId}, not ${obligation.policyId}` };
  }
  if (proof.obligationHash.toLowerCase() !== (obligation.obligationHash ?? "").toLowerCase()) {
    return { ok: false, reason: "proof obligation hash does not match the frozen obligation" };
  }
  if (proof.conditionId.toLowerCase() !== obligation.conditionId.toLowerCase()) {
    return { ok: false, reason: "proof condition does not match the obligation condition" };
  }
  if (proof.beneficiary.toLowerCase() !== obligation.treasuryAddress.toLowerCase()) {
    return { ok: false, reason: "proof beneficiary does not match the obligated beneficiary" };
  }
  const faceValue = obligation.faceValueUsdc ?? obligation.positionValueUsdc ?? "0";
  if (proof.amountUsdc !== faceValue) {
    return { ok: false, reason: `proof amount ${proof.amountUsdc} != obligated ${faceValue}` };
  }
  if (proof.tokenAddress.toLowerCase() !== USDC.toLowerCase()) {
    return { ok: false, reason: "proof token is not the obligated USDC contract" };
  }
  const expected = computeVerificationId(proof);
  if (expected !== proof.verificationId) {
    return { ok: false, reason: "proof verification id mismatch — proof payload was altered" };
  }
  return { ok: true };
}

/**
 * Rebuild a proof from a legacy SETTLED obligation's recorded events. Used only
 * for obligations settled before proof persistence existed; the rebuilt proof
 * still has to pass validateSettlementProof and on-chain re-verification.
 */
export function deriveProofFromPolicy(policy: Policy): SettlementProof | undefined {
  const events = [...policy.events].reverse();
  const distribution =
    events.find(
      (e) => e.type === "TRANSACTION" && e.meta?.kind === "distribution" && (e.txHashes?.length ?? 0) > 0
    ) ?? events.find((e) => e.type === "TRANSACTION" && (e.txHashes?.length ?? 0) > 0);
  const settlementTxHash = distribution?.txHashes?.[0];
  if (!settlementTxHash) return undefined;
  const settledAt = events.find((e) => e.type === "SETTLED")?.at ?? policy.updatedAt;
  const executionId =
    (distribution?.meta?.executionId as string | undefined) ?? undefined;
  return buildSettlementProof({
    policyId: policy.policyId,
    settlementTxHash,
    beneficiary: policy.treasuryAddress,
    amountUsdc: policy.faceValueUsdc ?? policy.positionValueUsdc ?? "0",
    tokenAddress: USDC,
    conditionId: policy.conditionId,
    obligationHash: policy.obligationHash ?? "",
    executionId,
    verifiedAt: settledAt,
  });
}

/**
 * Return a valid, persisted proof for a settled obligation. If none is stored
 * (legacy row), one is derived, validated, and persisted so downstream chained
 * obligations reference a stable proof object.
 */
export function ensureSettlementProof(policy: Policy): {
  ok: boolean;
  proof?: SettlementProof;
  reason?: string;
} {
  const stored = validateSettlementProof(policy.proof, policy);
  if (stored.ok) return { ok: true, proof: policy.proof };

  const derived = deriveProofFromPolicy(policy);
  const validated = validateSettlementProof(derived, policy);
  if (validated.ok && derived) {
    recordProof(policy.policyId, derived);
    return { ok: true, proof: derived };
  }
  return {
    ok: false,
    reason: stored.reason === "no settlement proof persisted" ? validated.reason : stored.reason,
  };
}

/** Persist a settlement proof for an obligation that just closed PROVEN. */
export function recordSettlementProof(input: {
  policy: Policy;
  settlementTxHash: string;
  executionId?: string;
  verifiedAt?: string;
}): SettlementProof {
  const proof = buildSettlementProof({
    policyId: input.policy.policyId,
    settlementTxHash: input.settlementTxHash,
    beneficiary: input.policy.treasuryAddress,
    amountUsdc: input.policy.faceValueUsdc ?? input.policy.positionValueUsdc ?? "0",
    tokenAddress: USDC,
    conditionId: input.policy.conditionId,
    obligationHash: input.policy.obligationHash ?? "",
    executionId: input.executionId,
    verifiedAt: input.verifiedAt ?? new Date().toISOString(),
  });
  recordProof(input.policy.policyId, proof);
  return proof;
}
