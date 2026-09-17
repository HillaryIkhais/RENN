import { test } from "node:test";
import assert from "node:assert/strict";
import { assertChainUnlocked } from "../src/policy/chain.js";
import { verifySettlement } from "../src/policy/verify.js";
import type { Policy, PolicyEvent, SettlementProof } from "../src/policy/types.js";
import { buildSettlementProof } from "../src/policy/proof.js";
import {
  BENEFICIARY,
  CONDITION_A,
  distributionEvent,
  fakePolicy,
  OTHER_BENEFICIARY,
  OTHER_TOKEN,
  transferLog,
  USDC_ADDRESS,
} from "./helpers.js";

const TX = `0x${"cd".repeat(32)}`;

function proofFor(policy: Policy): SettlementProof {
  return buildSettlementProof({
    policyId: policy.policyId,
    settlementTxHash: TX,
    beneficiary: policy.treasuryAddress,
    amountUsdc: policy.faceValueUsdc ?? "0",
    tokenAddress: USDC_ADDRESS,
    conditionId: policy.conditionId,
    obligationHash: policy.obligationHash ?? "",
    verifiedAt: new Date(0).toISOString(),
  });
}

function redemptionOnlyEvent(): PolicyEvent {
  return {
    at: new Date(0).toISOString(),
    type: "TRANSACTION",
    txHashes: [TX],
    message: "Redeemed winning CTF shares via KeeperHub",
    meta: { executionId: "exec-redeem", kind: "redemption" },
  };
}

const resolved = { resolved: true, payoutDenominator: 1n };

test("predecessor absent blocks the child", async () => {
  const child = fakePolicy({ policyId: "policy-child", state: "LOCKED", dependsOn: "policy-missing" });
  await assert.rejects(
    () => assertChainUnlocked("policy-child", { getPolicy: (id) => (id === "policy-child" ? child : undefined) }),
    /CHAIN BLOCKED/
  );
});

test("unsettled predecessor blocks the child", async () => {
  const predecessor = fakePolicy({ policyId: "policy-root", state: "LOCKED" });
  const child = fakePolicy({ policyId: "policy-child", state: "LOCKED", dependsOn: "policy-root" });
  const policies = new Map([
    ["policy-child", child],
    ["policy-root", predecessor],
  ]);
  await assert.rejects(
    () => assertChainUnlocked("policy-child", { getPolicy: (id) => policies.get(id) }),
    /not PROVEN_SETTLED/
  );
});

test("settled predecessor without a valid proof blocks the child", async () => {
  const predecessor = fakePolicy({ policyId: "policy-root", state: "SETTLED" });
  const child = fakePolicy({ policyId: "policy-child", state: "LOCKED", dependsOn: "policy-root" });
  const policies = new Map([
    ["policy-child", child],
    ["policy-root", predecessor],
  ]);
  await assert.rejects(
    () =>
      assertChainUnlocked("policy-child", {
        getPolicy: (id) => policies.get(id),
        verifySettlement: async () => ({ policyId: "policy-root", verdict: "PROVEN", checks: [] }),
      }),
    /no valid persisted settlement proof/
  );
});

test("a proven predecessor unlocks the child", async () => {
  const predecessor = fakePolicy({ policyId: "policy-root", state: "SETTLED" });
  const child = fakePolicy({ policyId: "policy-child", state: "LOCKED", dependsOn: "policy-root" });
  predecessor.proof = proofFor(predecessor);
  const policies = new Map([
    ["policy-child", child],
    ["policy-root", predecessor],
  ]);
  const unlock = await assertChainUnlocked("policy-child", {
    getPolicy: (id) => policies.get(id),
    verifySettlement: async () => ({ policyId: "policy-root", verdict: "PROVEN", checks: [] }),
  });
  assert.equal(unlock.predecessorId, "policy-root");
  assert.equal(unlock.predecessorProof, "PROVEN_SETTLED");
});

test("a proof that does not re-verify on chain blocks the child", async () => {
  const predecessor = fakePolicy({ policyId: "policy-root", state: "SETTLED" });
  const child = fakePolicy({ policyId: "policy-child", state: "LOCKED", dependsOn: "policy-root" });
  predecessor.proof = proofFor(predecessor);
  const policies = new Map([
    ["policy-child", child],
    ["policy-root", predecessor],
  ]);
  await assert.rejects(
    () =>
      assertChainUnlocked("policy-child", {
        getPolicy: (id) => policies.get(id),
        verifySettlement: async () => ({ policyId: "policy-root", verdict: "DISPUTED", checks: [] }),
      }),
    /does not independently verify on chain/
  );
});

test("provisional resolution yields BLOCKED", async () => {
  const policy = fakePolicy({ state: "RESOLVED", events: [distributionEvent(TX)] });
  const result = await verifySettlement(policy.policyId, {
    getPolicy: () => policy,
    getResolution: async () => ({ resolved: false, payoutDenominator: 0n }),
    getTransactionReceipt: async () => ({ status: 1, logs: [] }),
  });
  assert.equal(result.verdict, "BLOCKED");
});

test("redemption without distribution cannot become settled", async () => {
  const policy = fakePolicy({ state: "EXECUTING", events: [redemptionOnlyEvent()] });
  const result = await verifySettlement(policy.policyId, {
    getPolicy: () => policy,
    getResolution: async () => resolved,
    getTransactionReceipt: async () => ({
      status: 1,
      logs: [
        // collateral leaving the CTF, not the obligation's beneficiary transfer
        transferLog({ token: USDC_ADDRESS, from: OTHER_BENEFICIARY, to: BENEFICIARY, amountBaseUnits: 0n }),
      ],
    }),
  });
  assert.equal(result.verdict, "DISPUTED");
  assert.equal(result.checks.find((c) => c.name === "TRANSFER")?.ok, false);
});

test("exact Transfer event proves settlement (PROVEN)", async () => {
  const policy = fakePolicy({ state: "EXECUTING", events: [distributionEvent(TX)] });
  const result = await verifySettlement(policy.policyId, {
    getPolicy: () => policy,
    getResolution: async () => resolved,
    getTransactionReceipt: async () => ({
      status: 1,
      logs: [
        transferLog({ token: USDC_ADDRESS, from: OTHER_BENEFICIARY, to: BENEFICIARY, amountBaseUnits: 1_000_000n }),
      ],
    }),
  });
  assert.equal(result.verdict, "PROVEN");
});

test("wrong beneficiary Transfer event fails verification", async () => {
  const policy = fakePolicy({ state: "EXECUTING", events: [distributionEvent(TX)] });
  const result = await verifySettlement(policy.policyId, {
    getPolicy: () => policy,
    getResolution: async () => resolved,
    getTransactionReceipt: async () => ({
      status: 1,
      logs: [
        transferLog({ token: USDC_ADDRESS, from: OTHER_BENEFICIARY, to: OTHER_BENEFICIARY, amountBaseUnits: 1_000_000n }),
      ],
    }),
  });
  assert.equal(result.verdict, "DISPUTED");
});

test("wrong amount Transfer event fails verification", async () => {
  const policy = fakePolicy({ state: "EXECUTING", events: [distributionEvent(TX)] });
  const result = await verifySettlement(policy.policyId, {
    getPolicy: () => policy,
    getResolution: async () => resolved,
    getTransactionReceipt: async () => ({
      status: 1,
      logs: [
        transferLog({ token: USDC_ADDRESS, from: OTHER_BENEFICIARY, to: BENEFICIARY, amountBaseUnits: 999_999n }),
      ],
    }),
  });
  assert.equal(result.verdict, "DISPUTED");
});

test("wrong token Transfer event fails verification", async () => {
  const policy = fakePolicy({ state: "EXECUTING", events: [distributionEvent(TX)] });
  const result = await verifySettlement(policy.policyId, {
    getPolicy: () => policy,
    getResolution: async () => resolved,
    getTransactionReceipt: async () => ({
      status: 1,
      logs: [
        transferLog({ token: OTHER_TOKEN, from: OTHER_BENEFICIARY, to: BENEFICIARY, amountBaseUnits: 1_000_000n }),
      ],
    }),
  });
  assert.equal(result.verdict, "DISPUTED");
});

test("zero-value obligation is verified separately and never claimed as settlement", async () => {
  const policy = fakePolicy({ state: "EXECUTING", faceValueUsdc: "0", events: [distributionEvent(TX)] });
  const result = await verifySettlement(policy.policyId, {
    getPolicy: () => policy,
    getResolution: async () => resolved,
    getTransactionReceipt: async () => ({ status: 1, logs: [] }),
  });
  assert.equal(result.verdict, "PROVEN");
  assert.match(result.checks.find((c) => c.name === "TRANSFER")?.detail ?? "", /zero-value/);
});

test("a re-pointed dependency changes the frozen obligation hash", async () => {
  const base = fakePolicy({ policyId: "policy-child", state: "LOCKED", conditionId: CONDITION_A });
  const chainedA = fakePolicy({
    policyId: "policy-child",
    state: "LOCKED",
    conditionId: CONDITION_A,
    dependsOn: "policy-root-a",
  });
  const chainedB = fakePolicy({
    policyId: "policy-child",
    state: "LOCKED",
    conditionId: CONDITION_A,
    dependsOn: "policy-root-b",
  });
  assert.notEqual(base.obligationHash, chainedA.obligationHash);
  assert.notEqual(chainedA.obligationHash, chainedB.obligationHash);
});
