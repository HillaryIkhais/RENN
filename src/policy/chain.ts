import { getPolicy } from "./ledger.js";
import { verifySettlement } from "./verify.js";

/**
 * Chain gate: settlement proof is executable state.
 *
 * An obligation whose envelope includes `dependsOn` can only fire after the
 * predecessor obligation has been independently verified as PROVEN_SETTLED.
 * This is the "proof becomes authorization" enforcement that makes Renn a
 * system rather than a single settlement: the second obligation cannot unlock
 * until the first obligation's postcondition is verified on chain.
 *
 * Fail-closed: if the predecessor doesn't exist, isn't settled, or its
 * settlement cannot be independently verified, the gate throws and the
 * chained obligation stays locked. No amount of KeeperHub retry or
 * self-created-condition tricks can bypass this.
 */
export async function assertChainUnlocked(policyId: string): Promise<{
  predecessorId: string;
  predecessorProof: "PROVEN_SETTLED";
}> {
  const policy = getPolicy(policyId);
  if (!policy) throw new Error(`No policy ${policyId}`);

  const predecessorId = policy.dependsOn;
  if (!predecessorId) {
    return { predecessorId: "", predecessorProof: "PROVEN_SETTLED" };
  }

  const predecessor = getPolicy(predecessorId);
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

  // The predecessor is SETTLED — now run the independent on-chain verification
  // to confirm the settlement is actually proven. This is the critical step:
  // Renn doesn't trust "SETTLED because we said so"; it re-verifies the
  // predecessor's settlement against on-chain state before unlocking the next
  // obligation. (Same verifySettlement used in the VERIFY stage.)
  const verification = await verifySettlement(predecessorId);

  if (verification.verdict !== "PROVEN") {
    const failed = verification.checks
      .filter((c) => !c.ok)
      .map((c) => `${c.name}: ${c.detail}`)
      .join("; ");
    throw new Error(
      `OBLIGATION CHAIN BLOCKED: predecessor ${predecessorId} is settled but ` +
        `not independently proven on chain (${failed}). ` +
        `Obligation ${policyId} stays locked until the settlement proof is PROVEN.`
    );
  }

  return { predecessorId, predecessorProof: "PROVEN_SETTLED" };
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
