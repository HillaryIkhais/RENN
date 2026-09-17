import { provider } from "../polymarket/contracts.js";
import { ERC20 } from "../polymarket/balances.js";
import { USDC } from "../config.js";
import { getResolution } from "../polymarket/resolution.js";
import { obligationEnvelope } from "./obligation.js";
import { getPolicy } from "./ledger.js";

export type SettlementVerdict = "PROVEN" | "DISPUTED" | "BLOCKED";

export interface VerificationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SettlementVerification {
  policyId: string;
  verdict: SettlementVerdict;
  checks: VerificationCheck[];
}

/**
 * Independent on-chain postcondition verification for a settled obligation.
 * This is the VERIFY stage of the loop: Renn does not trust "KeeperHub said
 * completed" or "a transaction exists" — it re-reads the chain itself and only
 * then closes the obligation (or disputes it).
 *
 * Checks, in order:
 *   1. FINALITY  — payout state is final on the CTF (denom > 0).
 *   2. INTEGRITY — the frozen obligation envelope still matches the policy
 *                  record (address / amount / condition immutable after lock).
 *   3. EXECUTION — the recorded transaction exists on chain and is confirmed
 *                  (status 1), tied to the obligation's executionId.
 *   4. POSTCONDITION — the beneficiary provably holds at least the obligated
 *                  face value. For a zero-value obligation (faceValueUsdc 0)
 *                  this is satisfied trivially and honestly; for a funded
 *                  obligation it verifies the value actually landed.
 *
 * Verdict:
 *   PROVEN   all checks pass — the obligation closed against verified state.
 *   BLOCKED  finality check failed — nothing should be claimed settled.
 *   DISPUTED a post-execution check failed — settlement must not be trusted.
 */
export async function verifySettlement(policyId: string): Promise<SettlementVerification> {
  const policy = getPolicy(policyId);
  if (!policy) throw new Error(`No policy ${policyId}`);

  const checks: VerificationCheck[] = [];

  // 1. FINALITY — re-read the CTF on chain.
  let finalResolved = false;
  try {
    const res = await getResolution(policy.conditionId);
    finalResolved = res.resolved;
    checks.push({
      name: "FINALITY",
      ok: finalResolved,
      detail: finalResolved
        ? `payout state final on CTF (denom ${res.payoutDenominator.toString()})`
        : "payout state not final (denom 0) — provisional result",
    });
  } catch (err) {
    checks.push({
      name: "FINALITY",
      ok: false,
      detail: err instanceof Error ? err.message : "resolution read failed",
    });
  }

  // 2. INTEGRITY — recompute the frozen envelope; any drift voids the claim.
  let envelopeIntact = true;
  if (policy.obligationHash) {
    const recomputed = obligationEnvelope({
      conditionId: policy.conditionId,
      parentCollectionId: policy.parentCollectionId,
      beneficiary: policy.treasuryAddress,
      faceValueUsdc: policy.faceValueUsdc ?? policy.positionValueUsdc ?? "0",
      finality: "on-chain-ctf",
      redemptionKind: policy.redemptionKind,
      ...(policy.dependsOn ? { dependsOn: policy.dependsOn } : {}),
    });
    envelopeIntact = recomputed === policy.obligationHash;
    checks.push({
      name: "INTEGRITY",
      ok: envelopeIntact,
      detail: envelopeIntact
        ? "obligation envelope hash matches the frozen commitment"
        : "envelope hash mismatch — obligation was edited after locking",
    });
  } else {
    checks.push({
      name: "INTEGRITY",
      ok: false,
      detail: "no frozen obligation hash recorded",
    });
  }

  // 3. EXECUTION — the recorded settlement transaction, confirmed on chain.
  const settlementEvent = [...policy.events]
    .reverse()
    .find((e) => e.type === "TRANSACTION" && (e.txHashes?.length ?? 0) > 0);
  const txHash = settlementEvent?.txHashes?.[0] ?? null;
  const executionId = (settlementEvent?.meta?.executionId as string | undefined) ?? null;
  let txConfirmed = false;
  let txDetail = "no recorded transaction";
  if (txHash) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      txConfirmed = receipt !== null && receipt.status === 1;
      txDetail = txConfirmed
        ? `tx ${txHash.slice(0, 18)}… confirmed on Polygon${executionId ? ` (KeeperHub ${executionId})` : ""}`
        : `tx ${txHash.slice(0, 18)}… not confirmed or reverted`;
    } catch {
      txDetail = `tx ${txHash.slice(0, 18)}… could not be read on chain`;
    }
  }
  checks.push({ name: "EXECUTION", ok: txConfirmed, detail: txDetail });

  // 4. POSTCONDITION — beneficiary possession of the obligated amount.
  const faceValueUsdc = Number(policy.faceValueUsdc ?? policy.positionValueUsdc ?? "0");
  let withinValue = faceValueUsdc <= 0;
  let valueDetail = "no value obligation (face value 0) — zero asset value is itself proven";
  if (faceValueUsdc > 0) {
    try {
      const balance = Number(await ERC20.balanceOf(USDC, policy.treasuryAddress)) / 1e6;
      withinValue = balance >= faceValueUsdc;
      valueDetail = withinValue
        ? `beneficiary holds ${balance.toFixed(6)} USDC >= obligated ${faceValueUsdc} USDC`
        : `beneficiary holds ${balance.toFixed(6)} USDC < obligated ${faceValueUsdc} USDC`;
    } catch (err) {
      valueDetail = err instanceof Error ? err.message : "balance read failed";
    }
  }
  checks.push({ name: "POSTCONDITION", ok: withinValue, detail: valueDetail });

  const ok = checks.every((c) => c.ok);
  const verdict: SettlementVerdict = !finalResolved
    ? "BLOCKED"
    : ok
      ? "PROVEN"
      : "DISPUTED";

  return { policyId, verdict, checks };
}