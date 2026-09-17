import { getPolicy } from "./ledger.js";
import { verifySettlement, type SettlementVerification } from "./verify.js";
import { ensureSettlementProof } from "./proof.js";
import type { Policy, SettlementProof } from "./types.js";

export interface ChainUnlock {
  predecessorId: string;
  predecessorProof: "PROVEN_SETTLED";
  proof?: SettlementProof;
}

export interface ChainDeps {
  getPolicy: (policyId: string) => Policy | undefined;
  verifySettlement: (policyId: string) => Promise<SettlementVerification>;
  ensureSettlementProof: (policy: Policy) => { ok: boolean; proof?: SettlementProof; reason?: string };
}

const defaultDeps: ChainDeps = {
  getPolicy,
  verifySettlement: (policyId) => verifySettlement(policyId),
  ensureSettlementProof,
};

/**
 * Chain gate: settlement proof is executable state.
 *
 * An obligation whose envelope includes `dependsOn` can only fire after the
 * predecessor obligation has been independently verified as PROVEN_SETTLED.
 * The child references the predecessor's persisted settlement PROOF — not
 * merely `state === SETTLED` — and the proof is re-validated against the frozen
 * obligation and on-chain state before the gate opens.
 *
 * Fail-closed: missing predecessor, unsettled predecessor, missing/tampered
 * proof, or a failed live re-verification all leave the chained obligation
 * locked. No amount of KeeperHub retry can bypass this.
 */
export async function assertChainUnlocked(
  policyId: string,
  deps: Partial<ChainDeps> = {}
): Promise<ChainUnlock> {
  const d: ChainDeps = { ...defaultDeps, ...deps };
  const policy = d.getPolicy(policyId);
  if (!policy) throw new Error(`No policy ${policyId}`);

  const predecessorId = policy.dependsOn;
  if (!predecessorId) {
    return { predecessorId: "", predecessorProof: "PROVEN_SETTLED" };
  }

  const predecessor = d.getPolicy(predecessorId);
  if (!predecessor) {
    throw new Error(
      `OBLIGATION CHAIN BLOCKED: predecessor ${predecessorId} does not exist. ` +
        `Obligation ${policyId} cannot unlock — the chain root is missing.`
    );
  }

  if (predecessor.state !== "SETTLED") {
    throw new Error(
      `OBLIGATION CHAIN BLOCKED: predecessor ${predecessorId} is ${predecessor.state}, ` +
        `not PROVEN_SETTLED. Obligation ${policyId} stays locked until the ` +
        `preceding settlement proof closes the chain.`
    );
  }

  // The predecessor is SETTLED — require a valid persisted PROOF object (the
  // authorization the child references). `state === SETTLED` alone is not
  // enough: a settled obligation with no proof metadata cannot unlock a child.
  const proofResult = d.ensureSettlementProof(predecessor);
  if (!proofResult.ok || !proofResult.proof) {
    throw new Error(
      `OBLIGATION CHAIN BLOCKED: predecessor ${predecessorId} is SETTLED but has ` +
        `no valid settlement proof (${proofResult.reason ?? "unknown"}). ` +
        `Obligation ${policyId} stays locked until a PROVEN proof is persisted.`
    );
  }

  // Defense in depth: re-verify the predecessor's settlement against on-chain
  // state. The proof is only as good as the chain it describes.
  const verification = await d.verifySettlement(predecessorId);
  if (verification.verdict !== "PROVEN") {
    const failed = verification.checks
      .filter((c) => !c.ok)
      .map((c) => `${c.name}: ${c.detail}`)
      .join("; ");
    throw new Error(
      `OBLIGATION CHAIN BLOCKED: predecessor ${predecessorId} has a proof but does ` +
        `not independently verify on chain (${failed}). ` +
        `Obligation ${policyId} stays locked until the settlement proof is PROVEN.`
    );
  }

  return { predecessorId, predecessorProof: "PROVEN_SETTLED", proof: proofResult.proof };
}

/**
 * Render the chain status for `pnpm status`. Groups policies by `chainId`
 * and prints the unlock sequence with state + verification evidence.
 */
export async function renderChain(
  policies: Array<{ policyId: string; state: string; chainId?: string; dependsOn?: string; faceValueUsdc?: string }>
): Promise<string[]> {
  const chains = new Map<string, typeof policies>();
  for (const p of policies) {
    if (!p.chainId) continue;
    const list = chains.get(p.chainId) ?? [];
    list.push(p);
    chains.set(p.chainId, list);
  }
  if (chains.size === 0) return [];

  const lines: string[] = [];
  for (const [chainId, legs] of chains) {
    legs.sort((a, b) => {
      if (!a.dependsOn) return -1;
      if (!b.dependsOn) return 1;
      if (a.dependsOn === b.policyId) return -1;
      if (b.dependsOn === a.policyId) return 1;
      return 0;
    });
    const allSettled = legs.every((l) => l.state === "SETTLED");
    lines.push(`\n  CHAIN: ${chainId} (${legs.length} obligations${allSettled ? " — CLOSED" : ""})`);
    for (let i = 0; i < legs.length; i++) {
      const p = legs[i];
      const arrow = i > 0 ? "  -> " : "  #1  ";
      const tag = allSettled && i === legs.length - 1 ? " PROVEN CHAIN COMPLETE" : "";
      lines.push(
        `${arrow}${p.policyId} ${p.state}${tag}`
      );
    }
  }
  return lines;
}
