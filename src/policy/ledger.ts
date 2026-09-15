import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "../config.js";
import type { Policy, PolicyEvent, PolicyEventType, PolicyInput } from "./types.js";

const LEDGER_FILE = join(DATA_DIR, "ledger.jsonl");

function ensureDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

export function reload(): Policy[] {
  ensureDir();
  let raw: string;
  try {
    raw = readFileSync(LEDGER_FILE, "utf8");
  } catch {
    return [];
  }
  const policies = new Map<string, Policy>();
  for (const line of raw.split("\n").filter(Boolean)) {
    const entry = JSON.parse(line) as { policyId: string; event: PolicyEvent };
    let policy = policies.get(entry.policyId);
    if (!policy) {
      policy = {
        policyId: entry.policyId,
        state: "ARMED",
        createdAt: entry.event.at,
        updatedAt: entry.event.at,
        events: [],
        marketId: 0,
        question: "",
        conditionId: "",
        parentCollectionId: "0x0000000000000000000000000000000000000000000000000000000000000000",
        negRisk: false,
        treasuryAddress: "",
        redemptionKind: "classic",
      };
      policies.set(entry.policyId, policy);
    }
    policy.events.push(entry.event);
    const transitions: Record<string, Policy["state"] | undefined> = {
      ARMED: "ARMED",
      LOCKED: "LOCKED",
      RESOLVED: "RESOLVED",
      EXECUTING: "EXECUTING",
      SETTLED: "SETTLED",
      FAILED: "FAILED",
      EXPIRED: "EXPIRED",
    };
    const next = transitions[entry.event.type];
    if (next) {
      policy.state = next;
      policy.updatedAt = entry.event.at;
    }
    if (entry.event.meta?.policy) {
      Object.assign(policy, entry.event.meta.policy);
    }
  }
  return [...policies.values()];
}

export function getPolicy(policyId: string): Policy | undefined {
  return reload().find((p) => p.policyId === policyId);
}

function append(policyId: string, event: PolicyEvent): void {
  ensureDir();
  const line = JSON.stringify({ policyId, at: event.at, event });
  writeFileSync(LEDGER_FILE, `${line}\n`, { flag: "a" });
}

export function arm(input: PolicyInput): Policy {
  const policyId = input.marketId ? `policy-${input.marketId}` : `policy-${randomUUID().slice(0, 8)}`;
  const at = new Date().toISOString();
  append(policyId, {
    at,
    type: "ARMED",
    state: "ARMED",
    message: "Policy armed",
    meta: { policy: { ...input, policyId } },
  });
  return getPolicy(policyId)!;
}

export function transition(
  policyId: string,
  type: PolicyEventType,
  message?: string,
  meta?: Record<string, unknown>
): Policy | undefined {
  const at = new Date().toISOString();
  append(policyId, { at, type, state: type as Policy["state"], message, meta });
  return getPolicy(policyId);
}

export function recordTransaction(
  policyId: string,
  txHashes: string[],
  txLinks: string[],
  message: string,
  meta?: Record<string, unknown>
): Policy | undefined {
  const at = new Date().toISOString();
  append(policyId, {
    at,
    type: "TRANSACTION",
    txHashes,
    txLinks,
    message,
    meta,
  });
  return getPolicy(policyId);
}

export function resetLedger(): void {
  ensureDir();
  writeFileSync(LEDGER_FILE, "");
}