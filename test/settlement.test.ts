import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSettlementTransfer } from "../src/policy/verify.js";
import {
  buildSettlementProof,
  validateSettlementProof,
} from "../src/policy/proof.js";
import {
  BENEFICIARY,
  fakePolicy,
  OTHER_BENEFICIARY,
  OTHER_TOKEN,
  transferLog,
  USDC_ADDRESS,
} from "./helpers.js";

const FACE = 1_000_000n; // 1 USDC in base units

test("exact Transfer(token -> beneficiary, obligated amount) proves the transfer", () => {
  const logs = [
    transferLog({ token: USDC_ADDRESS, from: OTHER_BENEFICIARY, to: BENEFICIARY, amountBaseUnits: FACE }),
  ];
  const result = matchSettlementTransfer(logs, {
    tokenAddress: USDC_ADDRESS,
    beneficiary: BENEFICIARY,
    amountBaseUnits: FACE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.matched, FACE);
});

test("a Transfer to the wrong beneficiary fails verification", () => {
  const logs = [
    transferLog({ token: USDC_ADDRESS, from: BENEFICIARY, to: OTHER_BENEFICIARY, amountBaseUnits: FACE }),
  ];
  const result = matchSettlementTransfer(logs, {
    tokenAddress: USDC_ADDRESS,
    beneficiary: BENEFICIARY,
    amountBaseUnits: FACE,
  });
  assert.equal(result.ok, false);
  assert.equal(result.matched, 0n);
});

test("a Transfer of the wrong amount fails verification", () => {
  const logs = [
    transferLog({ token: USDC_ADDRESS, from: OTHER_BENEFICIARY, to: BENEFICIARY, amountBaseUnits: FACE - 1n }),
  ];
  const result = matchSettlementTransfer(logs, {
    tokenAddress: USDC_ADDRESS,
    beneficiary: BENEFICIARY,
    amountBaseUnits: FACE,
  });
  assert.equal(result.ok, false);
});

test("a Transfer of the wrong token fails verification", () => {
  const logs = [
    transferLog({ token: OTHER_TOKEN, from: OTHER_BENEFICIARY, to: BENEFICIARY, amountBaseUnits: FACE }),
  ];
  const result = matchSettlementTransfer(logs, {
    tokenAddress: USDC_ADDRESS,
    beneficiary: BENEFICIARY,
    amountBaseUnits: FACE,
  });
  assert.equal(result.ok, false);
  assert.equal(result.hits, 0);
});

test("multiple transfers summing to the obligated amount prove the transfer", () => {
  const logs = [
    transferLog({ token: USDC_ADDRESS, from: OTHER_BENEFICIARY, to: BENEFICIARY, amountBaseUnits: 400_000n }),
    transferLog({ token: USDC_ADDRESS, from: OTHER_BENEFICIARY, to: BENEFICIARY, amountBaseUnits: 600_000n }),
    transferLog({ token: USDC_ADDRESS, from: OTHER_BENEFICIARY, to: OTHER_BENEFICIARY, amountBaseUnits: 999_999n }),
  ];
  const result = matchSettlementTransfer(logs, {
    tokenAddress: USDC_ADDRESS,
    beneficiary: BENEFICIARY,
    amountBaseUnits: FACE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.matched, FACE);
});

test("a valid persisted proof passes validation", () => {
  const policy = fakePolicy({ state: "SETTLED" });
  const proof = buildSettlementProof({
    policyId: policy.policyId,
    settlementTxHash: `0x${"ab".repeat(32)}`,
    beneficiary: policy.treasuryAddress,
    amountUsdc: policy.faceValueUsdc ?? "0",
    tokenAddress: USDC_ADDRESS,
    conditionId: policy.conditionId,
    obligationHash: policy.obligationHash ?? "",
    executionId: "exec-1",
    verifiedAt: new Date(0).toISOString(),
  });
  const result = validateSettlementProof(proof, policy);
  assert.equal(result.ok, true);
});

test("tampering with a proof payload breaks its verification id", () => {
  const policy = fakePolicy({ state: "SETTLED" });
  const proof = buildSettlementProof({
    policyId: policy.policyId,
    settlementTxHash: `0x${"ab".repeat(32)}`,
    beneficiary: policy.treasuryAddress,
    amountUsdc: policy.faceValueUsdc ?? "0",
    tokenAddress: USDC_ADDRESS,
    conditionId: policy.conditionId,
    obligationHash: policy.obligationHash ?? "",
    verifiedAt: new Date(0).toISOString(),
  });
  const tampered = { ...proof, amountUsdc: "999" };
  const result = validateSettlementProof(tampered, policy);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /verification id|amount/);
});

test("a proof bound to a different obligation is rejected", () => {
  const policy = fakePolicy({ state: "SETTLED" });
  const proof = buildSettlementProof({
    policyId: "policy-other",
    settlementTxHash: `0x${"ab".repeat(32)}`,
    beneficiary: OTHER_BENEFICIARY,
    amountUsdc: policy.faceValueUsdc ?? "0",
    tokenAddress: USDC_ADDRESS,
    conditionId: policy.conditionId,
    obligationHash: policy.obligationHash ?? "",
    verifiedAt: new Date(0).toISOString(),
  });
  const result = validateSettlementProof(proof, policy);
  assert.equal(result.ok, false);
});
