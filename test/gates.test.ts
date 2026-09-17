import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertFinalityUnblocked,
  assertNotSettled,
  assertObligationIntact,
} from "../src/policy/gates.js";
import { fakePolicy } from "./helpers.js";

test("provisional resolution (WAITING_FINALITY) blocks execution", () => {
  const policy = fakePolicy({ state: "WAITING_FINALITY" });
  assert.throws(() => assertFinalityUnblocked(policy), /SETTLEMENT BLOCKED/);
});

test("a resolved obligation is not blocked by the finality gate", () => {
  const policy = fakePolicy({ state: "RESOLVED" });
  assert.doesNotThrow(() => assertFinalityUnblocked(policy));
});

test("a modified obligation hash blocks execution", () => {
  const policy = fakePolicy({ state: "RESOLVED" });
  policy.treasuryAddress = "0x000000000000000000000000000000000000bEEF";
  assert.throws(() => assertObligationIntact(policy), /LOCKED OBLIGATION MISMATCH/);
});

test("an intact obligation passes the immutability gate", () => {
  const policy = fakePolicy({ state: "RESOLVED" });
  assert.doesNotThrow(() => assertObligationIntact(policy));
});

test("a settled obligation cannot execute twice", () => {
  const policy = fakePolicy({ state: "SETTLED" });
  assert.throws(() => assertNotSettled(policy), /ALREADY SETTLED/);
});

test("a failed obligation can be retried (not exactly-once blocked)", () => {
  const policy = fakePolicy({ state: "FAILED" });
  assert.doesNotThrow(() => assertNotSettled(policy));
});
