import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the ledger before any module that reads DATA_DIR is imported.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "renn-ledger-"));

const { arm, getPolicy, transition, recordProof } = await import("../src/policy/ledger.js");
const { obligationEnvelope } = await import("../src/policy/obligation.js");
const { buildSettlementProof } = await import("../src/policy/proof.js");

const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const CONDITION = `0x${"33".repeat(32)}`;
const BENEFICIARY = "0x0716207e349F9928103aA2D6Cca2EE9BCC0174e1";

function armObligation(dependsOn?: string): string {
  const obligationHash = obligationEnvelope({
    conditionId: CONDITION,
    parentCollectionId: ZERO32,
    beneficiary: BENEFICIARY,
    faceValueUsdc: "1",
    finality: "on-chain-ctf",
    redemptionKind: "classic",
    ...(dependsOn ? { dependsOn } : {}),
  });
  const policy = arm({
    marketId: 0,
    question: "ledger test obligation",
    conditionId: CONDITION,
    parentCollectionId: ZERO32,
    negRisk: false,
    positionValueUsdc: "1",
    faceValueUsdc: "1",
    finality: "on-chain-ctf",
    obligationHash,
    treasuryAddress: BENEFICIARY,
    redemptionKind: "classic",
    ...(dependsOn ? { dependsOn } : {}),
  });
  transition(policy.policyId, "LOCKED", "obligation frozen");
  return policy.policyId;
}

test("a failed obligation retry preserves the same frozen obligation hash", () => {
  const policyId = armObligation();
  const frozen = getPolicy(policyId)?.obligationHash;
  assert.ok(frozen);

  transition(policyId, "RESOLVED", "finality reached");
  transition(policyId, "EXECUTING", "attempt 1");
  transition(policyId, "FAILED", "attempt 1 failed");

  const failed = getPolicy(policyId);
  assert.equal(failed?.state, "FAILED");
  assert.equal(failed?.obligationHash, frozen);

  transition(policyId, "EXECUTING", "retry");
  transition(policyId, "FAILED", "attempt 2 failed");

  const retried = getPolicy(policyId);
  assert.equal(retried?.state, "FAILED");
  assert.equal(retried?.obligationHash, frozen);
});

test("a chained obligation records its dependency and preserves it through failure", () => {
  const root = armObligation();
  const child = armObligation(root);
  assert.equal(getPolicy(child)?.dependsOn, root);

  transition(child, "FAILED", "child attempt failed");
  assert.equal(getPolicy(child)?.dependsOn, root);
  assert.equal(getPolicy(child)?.obligationHash, obligationEnvelope({
    conditionId: CONDITION,
    parentCollectionId: ZERO32,
    beneficiary: BENEFICIARY,
    faceValueUsdc: "1",
    finality: "on-chain-ctf",
    redemptionKind: "classic",
    dependsOn: root,
  }));
});

test("a settlement proof is persisted and reloadable", () => {
  const policyId = armObligation();
  transition(policyId, "SETTLED", "discharged");
  const policy = getPolicy(policyId);
  assert.ok(policy);

  const proof = buildSettlementProof({
    policyId,
    settlementTxHash: `0x${"ef".repeat(32)}`,
    beneficiary: policy.treasuryAddress,
    amountUsdc: policy.faceValueUsdc ?? "0",
    tokenAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    conditionId: policy.conditionId,
    obligationHash: policy.obligationHash ?? "",
    executionId: "exec-proof",
    verifiedAt: new Date(0).toISOString(),
  });
  recordProof(policyId, proof);

  const reloaded = getPolicy(policyId);
  assert.equal(reloaded?.proof?.verificationId, proof.verificationId);
  assert.equal(reloaded?.proof?.executionId, "exec-proof");
});
