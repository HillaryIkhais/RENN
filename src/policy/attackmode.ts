import { obligationEnvelope } from "./obligation.js";
import { assertNotSettled, assertObligationIntact } from "./gates.js";
import { assertChainUnlocked } from "./chain.js";
import { validateSettlementProof } from "./proof.js";
import { verifySettlement, type VerifyDeps, type SettlementVerification } from "./verify.js";
import type { Policy } from "./types.js";

/**
 * ATTACK MODE: the authorization boundary, attacked with Renn's real gate code.
 *
 * Every attack in this module calls the SAME functions the execute path calls
 * (gates.ts, chain.ts, proof.ts, verify.ts, obligation.ts). Nothing here
 * re-implements a gate, a hash, or a verdict: the BLOCKED results are the
 * engine's own refusals, reproduced verbatim. The dashboard renders these
 * results; it never becomes a second source of truth.
 *
 * Used by:
 *   - scripts/serve-dashboard.ts  (/attack endpoint — live, real RPC verify)
 *   - scripts/export-site.ts      (baked at export time, same code path)
 *   - test/attackmode.test.ts     (correctness suite, injected deps)
 */

export const ATTACK_IDS = [
  "change-beneficiary",
  "change-amount",
  "change-condition",
  "repoint-dependency",
  "tamper-proof",
  "execute-early",
  "execute-settled",
  "claim-settlement",
] as const;

export type AttackId = (typeof ATTACK_IDS)[number];

export interface AttackResult {
  attack: AttackId;
  title: string;
  target: string;
  blocked: boolean;
  gate: string;
  headline: string;
  detail: string;
  expected?: string;
  observed?: string;
  steps: string[];
}

export interface AttackOpts {
  policies: Policy[];
  /** injectable for static replay / tests; defaults to real on-chain verification */
  verifyDeps?: Partial<VerifyDeps>;
  /** the amount the attacker claims moved (CLAIM PAYMENT #1 SUCCEEDED) */
  claimAmountUsdc?: string;
}

const ATTACK_TITLES: Record<AttackId, string> = {
  "change-beneficiary": "Change the beneficiary after lock",
  "change-amount": "Change the amount after lock",
  "change-condition": "Change the condition after lock",
  "repoint-dependency": "Re-point obligation #2's dependency",
  "tamper-proof": "Tamper with the settlement proof",
  "execute-early": "Execute obligation #2 before its dependency settles",
  "execute-settled": "Execute a settled obligation again",
  "claim-settlement": "Claim payment #1 succeeded",
};

const GATES: Record<AttackId, string> = {
  "change-beneficiary": "GATE 1 — OBLIGATION IMMUTABILITY",
  "change-amount": "GATE 1 — OBLIGATION IMMUTABILITY",
  "change-condition": "GATE 1 — OBLIGATION IMMUTABILITY",
  "repoint-dependency": "GATE 1 — OBLIGATION IMMUTABILITY (envelope includes dependsOn)",
  "tamper-proof": "GATE 1.5 — CHAIN PROOF VALIDATION",
  "execute-early": "GATE 1.5 — CHAIN UNLOCK",
  "execute-settled": "GATE 0 — EXACTLY-ONCE",
  "claim-settlement": "PROOF GATE — SETTLEMENT VERIFICATION",
};

/** Locate the real two-obligation chain in the ledger (settled root + child). */
export function attackTargets(policies: Policy[]): { root: Policy; child: Policy } | null {
  for (const child of policies) {
    if (!child.dependsOn) continue;
    const root = policies.find((p) => p.policyId === child.dependsOn);
    if (root && root.state === "SETTLED") return { root, child };
  }
  return null;
}

function envelopeOf(p: Policy): string {
  return obligationEnvelope({
    conditionId: p.conditionId,
    parentCollectionId: p.parentCollectionId,
    beneficiary: p.treasuryAddress,
    faceValueUsdc: p.faceValueUsdc ?? p.positionValueUsdc ?? "0",
    finality: "on-chain-ctf",
    redemptionKind: p.redemptionKind,
    ...(p.dependsOn ? { dependsOn: p.dependsOn } : {}),
  });
}

function ok(id: AttackId, target: Policy, detail: string, steps: string[]): AttackResult {
  return { attack: id, title: ATTACK_TITLES[id], target: target.policyId, blocked: false, gate: GATES[id], headline: "NOT BLOCKED", detail, steps };
}

function refused(
  id: AttackId,
  target: Policy,
  err: unknown,
  extra: Partial<AttackResult> = {}
): AttackResult {
  return {
    attack: id,
    title: ATTACK_TITLES[id],
    target: target.policyId,
    blocked: true,
    gate: GATES[id],
    headline: "BLOCKED",
    detail: err instanceof Error ? err.message : String(err),
    steps: [],
    ...extra,
  };
}

/**
 * Run one attack against the real engine. Each case executes the actual gate
 * functions; a throw IS the refusal (reproduced verbatim in the result).
 */
export async function runAttack(attack: AttackId, opts: AttackOpts): Promise<AttackResult> {
  const targets = attackTargets(opts.policies);
  if (!targets) throw new Error("no settled obligation chain in the ledger to attack");
  const { root, child } = targets;

  switch (attack) {
    case "change-beneficiary":
    case "change-amount":
    case "change-condition":
    case "repoint-dependency": {
      const mutated: Policy = { ...root };
      let field = "";
      if (attack === "change-beneficiary") {
        mutated.treasuryAddress = "0x000000000000000000000000000000000000beef";
        field = "beneficiary";
      } else if (attack === "change-amount") {
        mutated.faceValueUsdc = "1";
        field = "face value";
      } else if (attack === "change-condition") {
        mutated.conditionId = `0x${"ab".repeat(32)}`;
        field = "condition";
      } else {
        mutated.dependsOn = "policy-attacker";
        field = "dependency";
      }
      const expected = envelopeOf(root);
      const recomputed = envelopeOf(mutated);
      try {
        assertObligationIntact(mutated);
      } catch (err) {
        return refused(attack, root, err, {
          expected: `frozen envelope ${expected.slice(0, 18)}…`,
          observed: `recomputed envelope ${recomputed.slice(0, 18)}…`,
          steps: [
            `Attacker edits the ${field} of the locked obligation`,
            `Canonical envelope re-derived from the mutated record`,
            `EXPECTED ${expected.slice(0, 14)}… ≠ RECOMPUTED ${recomputed.slice(0, 14)}…`,
            `LOCKED OBLIGATION MISMATCH — execution refused before broadcast`,
          ],
        });
      }
      return ok(attack, root, "mutation did not change the envelope hash (unexpected)", [
        `Attacker edits the ${field}`,
        `Envelope hash unchanged — gate opened (this must never happen)`,
      ]);
    }

    case "tamper-proof": {
      const realProof = root.proof;
      if (!realProof) throw new Error("root obligation has no persisted proof to tamper");
      const tampered = { ...realProof, amountUsdc: "999" };
      const proofCheck = validateSettlementProof(tampered, root);
      try {
        await assertChainUnlocked(child.policyId, {
          getPolicy: (id) =>
            id === root.policyId ? { ...root, proof: tampered } : opts.policies.find((p) => p.policyId === id),
        });
      } catch (err) {
        return refused(attack, child, err, {
          expected: `proof ${realProof.verificationId.slice(0, 18)}… (amount ${realProof.amountUsdc} USDC)`,
          observed: `tampered proof payload (amount ${tampered.amountUsdc} USDC) — verification id no longer matches`,
          steps: [
            `Attacker alters the persisted settlement proof of ${root.policyId}`,
            `Gate 1.5 re-validates the proof the child references`,
            proofCheck.ok ? "proof accepted (must never happen)" : `proof gate: ${proofCheck.reason}`,
            `OBLIGATION CHAIN BLOCKED — ${child.policyId} stays locked`,
          ],
        });
      }
      return ok(attack, child, "tampered proof unlocked the chain (unexpected)", [
        `Attacker alters the persisted proof`,
        `Chain gate opened (this must never happen)`,
      ]);
    }

    case "execute-early": {
      try {
        await assertChainUnlocked(child.policyId, {
          getPolicy: (id) => {
            const p = opts.policies.find((x) => x.policyId === id);
            return id === root.policyId && p ? { ...p, state: "LOCKED" } : p;
          },
        });
      } catch (err) {
        return refused(attack, child, err, {
          expected: `${root.policyId} PROVEN_SETTLED + valid persisted proof`,
          observed: `${root.policyId} LOCKED — the preceding settlement has not closed`,
          steps: [
            `Attacker fires ${child.policyId} while ${root.policyId} is only LOCKED`,
            `Gate 1.5 re-reads the predecessor state (fail-closed)`,
            `DEPENDENCY NOT SETTLED — ${child.policyId} stays locked`,
          ],
        });
      }
      return ok(attack, child, "chained obligation executed without a proven predecessor (unexpected)", [
        `Attacker fires ${child.policyId} early`,
        `Gate opened (this must never happen)`,
      ]);
    }

    case "execute-settled": {
      try {
        assertNotSettled(root);
      } catch (err) {
        return refused(attack, root, err, {
          expected: "an open execution authorization",
          observed: `${root.policyId} is SETTLED — the authorization is consumed`,
          steps: [
            `Attacker re-executes the settled obligation ${root.policyId}`,
            `Gate 0 checks the execution authorization`,
            `ALREADY SETTLED — no new payment authority exists`,
          ],
        });
      }
      return ok(attack, root, "settled obligation re-executed (unexpected)", [
        `Attacker re-executes ${root.policyId}`,
        `Gate opened (this must never happen)`,
      ]);
    }

    case "claim-settlement": {
      const claimed = opts.claimAmountUsdc ?? "1";
      const claimedObligation: Policy = { ...root, faceValueUsdc: claimed };
      const proofCheck = validateSettlementProof(root.proof, claimedObligation);
      let integrity = "envelope intact";
      try {
        assertObligationIntact(claimedObligation);
      } catch (err) {
        integrity = err instanceof Error ? err.message : String(err);
      }
      const verification: SettlementVerification = await verifySettlement(root.policyId, opts.verifyDeps);
      const transfer = verification.checks.find((c) => c.name === "TRANSFER");
      const blocked =
        !proofCheck.ok || verification.verdict !== "PROVEN" || (transfer ? !transfer.ok : true);
      const steps = [
        `Claim received: "PAYMENT #1 SUCCEEDED — ${claimed} USDC → ${root.treasuryAddress.slice(0, 10)}…"`,
        `Proof gate validates the claim against the persisted settlement proof`,
        proofCheck.ok ? "proof matches the claimed obligation" : `proof gate: ${proofCheck.reason}`,
        `Claim also edits the frozen obligation (face ${claimed} USDC): ${integrity}`,
        `On-chain verification: ${transfer?.detail ?? verification.verdict}`,
        blocked
          ? `CLAIM REJECTED — SETTLEMENT HAS NOT BEEN PROVEN; ${child.policyId} stays locked`
          : `claim accepted (the recorded settlement verified on chain)`,
      ];
      return {
        attack: "claim-settlement",
        title: ATTACK_TITLES["claim-settlement"],
        target: root.policyId,
        blocked,
        gate: GATES["claim-settlement"],
        headline: blocked ? "CLAIM REJECTED — SETTLEMENT HAS NOT BEEN PROVEN" : "CLAIM VERIFIED",
        detail: [
          proofCheck.ok ? "proof matches the claimed obligation" : `proof gate: ${proofCheck.reason}`,
          transfer?.detail ?? verification.verdict,
        ].join(" · "),
        expected: `${claimed} USDC → ${root.treasuryAddress.slice(0, 10)}… (exact Transfer event)`,
        observed: root.proof
          ? `persisted proof records ${root.proof.amountUsdc} USDC · verification ${verification.verdict}`
          : `no persisted settlement proof · verification ${verification.verdict}`,
        steps,
      };
    }
  }
}

/** Run every attack; used by the export and the /attacks endpoint. */
export async function runAllAttacks(opts: AttackOpts): Promise<AttackResult[]> {
  const results: AttackResult[] = [];
  for (const id of ATTACK_IDS) {
    try {
      results.push(await runAttack(id, opts));
    } catch (err) {
      results.push({
        attack: id,
        title: ATTACK_TITLES[id],
        target: "—",
        blocked: true,
        gate: GATES[id],
        headline: "UNAVAILABLE",
        detail: err instanceof Error ? err.message : String(err),
        steps: [],
      });
    }
  }
  return results;
}
