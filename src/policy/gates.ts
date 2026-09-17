import { obligationEnvelope } from "./obligation.js";
import type { Policy } from "./types.js";

/**
 * Pre-network execution gates. These are pure functions over a policy record so
 * they can be unit-tested without touching KeeperHub or the chain. Each throws a
 * named error when the obligation must not execute.
 */

/** Gate 0: exactly-once. A settled obligation cannot authorize another payment. */
export function assertNotSettled(policy: Policy): void {
  if (policy.state === "SETTLED") {
    throw new Error(
      "ALREADY SETTLED: obligation is closed; a settled obligation cannot authorize " +
        "another payment. Re-arm a new obligation to commit new value."
    );
  }
}

/**
 * Gate 1: obligation immutability. Recompute the frozen envelope from the
 * current policy record; any drift means the intent was edited, and the
 * commitment is void rather than reinterpreted. Includes the chain dependency
 * so re-pointing a chained obligation also voids.
 */
export function assertObligationIntact(policy: Policy): void {
  if (!policy.obligationHash) return;
  const expected = obligationEnvelope({
    conditionId: policy.conditionId,
    parentCollectionId: policy.parentCollectionId,
    beneficiary: policy.treasuryAddress,
    faceValueUsdc: policy.faceValueUsdc ?? policy.positionValueUsdc ?? "0",
    finality: "on-chain-ctf",
    redemptionKind: policy.redemptionKind,
    ...(policy.dependsOn ? { dependsOn: policy.dependsOn } : {}),
  });
  if (expected !== policy.obligationHash) {
    throw new Error(
      "LOCKED OBLIGATION MISMATCH: policy fields no longer match the frozen obligation hash. " +
        "Settlement is void; re-arm the obligation."
    );
  }
}

/** Gate 2: finality. A provisional outcome can never trigger settlement. */
export function assertFinalityUnblocked(policy: Policy): void {
  if (policy.state === "WAITING_FINALITY") {
    throw new Error(
      "SETTLEMENT BLOCKED: the outcome is provisional (finality window open). " +
        "No irreversible obligation fires on a preliminary result."
    );
  }
}
