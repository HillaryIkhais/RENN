import { test } from "node:test";
import assert from "node:assert/strict";
import { obligationEnvelope } from "../src/policy/obligation.js";
import { fakePolicy } from "./helpers.js";
import {
  runAttack,
  runAllAttacks,
  ATTACK_IDS,
  attackTargets,
} from "../src/policy/attackmode.js";
import type { VerifyDeps, SettlementVerification } from "../src/policy/verify.js";
import type { Policy } from "../src/policy/types.js";

const basePolicy = fakePolicy({
  policyId: "policy-root",
  state: "SETTLED",
  faceValueUsdc: "0",
  treasuryAddress: "0x0716207e349F9928103aA2D6Cca2EE9BCC0174e1",
});
basePolicy.proof = {
  policyId: "policy-root",
  settlementTxHash: "0x21a05f325036b07416756fa94ca46b4c079b0865f1b385bdf166e838910ac303",
  beneficiary: basePolicy.treasuryAddress,
  amountUsdc: "0",
  tokenAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  conditionId: basePolicy.conditionId,
  obligationHash: basePolicy.obligationHash,
  executionId: "kcdpl20ya8ddd315z35jo",
  verifiedAt: new Date().toISOString(),
  verificationId: obligationEnvelope({
    conditionId: basePolicy.conditionId,
    parentCollectionId: basePolicy.parentCollectionId,
    beneficiary: basePolicy.treasuryAddress,
    faceValueUsdc: basePolicy.faceValueUsdc,
    finality: "on-chain-ctf",
    redemptionKind: basePolicy.redemptionKind,
  }),
};

const childPolicy = fakePolicy({
  policyId: "policy-child",
  state: "SETTLED",
  faceValueUsdc: "0",
  dependsOn: "policy-root",
});

const policies = [basePolicy, childPolicy];

const mockVerifyDeps: VerifyDeps = {
  getPolicy: (id) => policies.find((p) => p.policyId === id),
  getResolution: async () => ({ resolved: true, payoutDenominator: 1n }),
  getTransactionReceipt: async () => ({
    status: 1,
    logs: [],
  }),
};

test("attackTargets finds the real chain", () => {
  const targets = attackTargets(policies);
  assert.ok(targets);
  assert.equal(targets.root.policyId, "policy-root");
  assert.equal(targets.child.policyId, "policy-child");
});

test("CHANGE BENEFICIARY is blocked by GATE 1", async () => {
  const result = await runAttack("change-beneficiary", { policies, verifyDeps: mockVerifyDeps });
  assert.equal(result.blocked, true);
  assert.ok(result.detail.includes("LOCKED OBLIGATION MISMATCH"));
  assert.ok(result.expected?.includes("frozen envelope"));
  assert.ok(result.observed?.includes("recomputed envelope"));
});

test("CHANGE AMOUNT is blocked by GATE 1", async () => {
  const result = await runAttack("change-amount", { policies, verifyDeps: mockVerifyDeps });
  assert.equal(result.blocked, true);
  assert.ok(result.detail.includes("LOCKED OBLIGATION MISMATCH"));
});

test("CHANGE CONDITION is blocked by GATE 1", async () => {
  const result = await runAttack("change-condition", { policies, verifyDeps: mockVerifyDeps });
  assert.equal(result.blocked, true);
  assert.ok(result.detail.includes("LOCKED OBLIGATION MISMATCH"));
});

test("RE-POINT DEPENDENCY is blocked by GATE 1 (envelope includes dependsOn)", async () => {
  const result = await runAttack("repoint-dependency", { policies, verifyDeps: mockVerifyDeps });
  assert.equal(result.blocked, true);
  assert.ok(result.detail.includes("LOCKED OBLIGATION MISMATCH"));
});

test("TAMPER PROOF is blocked by GATE 1.5", async () => {
  const result = await runAttack("tamper-proof", { policies, verifyDeps: mockVerifyDeps });
  assert.equal(result.blocked, true);
  assert.equal(result.headline, "PROOF INTEGRITY FAILED");
  assert.ok(result.detail.includes("OBLIGATION CHAIN BLOCKED"));
  assert.ok(result.detail.includes("no valid persisted settlement proof"));
});

test("DELETE PROOF is blocked by GATE 1.5 (predecessor not proven)", async () => {
  const result = await runAttack("delete-proof", { policies, verifyDeps: mockVerifyDeps });
  assert.equal(result.blocked, true);
  assert.equal(result.headline, "PREDECESSOR NOT PROVEN");
  assert.ok(result.detail.includes("OBLIGATION CHAIN BLOCKED"));
  assert.ok(result.detail.includes("no settlement proof persisted"));
  assert.ok(result.observed?.toLowerCase().includes("deleted"));
});

test("EXECUTE EARLY is blocked by GATE 1.5 (predecessor not settled)", async () => {
  const result = await runAttack("execute-early", { policies, verifyDeps: mockVerifyDeps });
  assert.equal(result.blocked, true);
  assert.equal(result.headline, "DEPENDENCY NOT SETTLED");
  assert.ok(result.detail.includes("OBLIGATION CHAIN BLOCKED"));
  assert.ok(result.detail.includes("LOCKED"));
});

test("EXECUTE SETTLED is blocked by GATE 0 (exactly-once)", async () => {
  const result = await runAttack("execute-settled", { policies, verifyDeps: mockVerifyDeps });
  assert.equal(result.blocked, true);
  assert.equal(result.headline, "ALREADY SETTLED");
  assert.ok(result.detail.includes("ALREADY SETTLED"));
});

test("CLAIM SETTLEMENT is rejected — proof amount 0 ≠ claimed 1", async () => {
  const result = await runAttack("claim-settlement", { policies, verifyDeps: mockVerifyDeps });
  assert.equal(result.blocked, true);
  assert.equal(result.headline, "NO VERIFIED TRANSFER");
  assert.ok(result.detail.includes("proof amount 0 != obligated 1"));
  assert.ok(result.detail.includes("zero-value obligation"));
});

test("runAllAttacks executes every attack and all are blocked", async () => {
  const results = await runAllAttacks({ policies, verifyDeps: mockVerifyDeps });
  assert.equal(results.length, ATTACK_IDS.length);
  for (const r of results) {
    assert.equal(r.blocked, true, `${r.attack} must be blocked`);
    assert.ok(r.gate);
    assert.ok(r.steps.length > 0);
  }
});

