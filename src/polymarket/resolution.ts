import { Contract } from "ethers";
import { CTF } from "../config.js";
import { CTF_ABI, provider } from "./contracts.js";

export interface ResolutionStatus {
  conditionId: string;
  resolved: boolean;
  payoutDenominator: bigint;
  payoutNumerators: [bigint, bigint];
}

/**
 * Read payoutDenominator(conditionId) on the CTF contract.
 * payoutDenominator > 0 iff the condition has been reported/resolved.
 */
export async function getResolution(
  conditionId: string
): Promise<ResolutionStatus> {
  const ctf = new Contract(CTF, CTF_ABI, provider);
  const denom = (await ctf.payoutDenominator(conditionId)) as bigint;
  const resolved = denom > 0n;
  let payoutNumerators: [bigint, bigint] = [0n, 0n];
  if (resolved) {
    const [n0, n1] = await Promise.all([
      ctf.payoutNumerators(conditionId, 0) as Promise<bigint>,
      ctf.payoutNumerators(conditionId, 1) as Promise<bigint>,
    ]);
    payoutNumerators = [n0, n1];
  }
  return { conditionId, resolved, payoutDenominator: denom, payoutNumerators };
}

/**
 * For a binary condition, returns 0 (No wins) or 1 (Yes wins) or null if not resolved.
 */
export function winningOutcome(status: ResolutionStatus): 0 | 1 | null {
  if (!status.resolved) return null;
  const [n0, n1] = status.payoutNumerators;
  return n1 > n0 ? 1 : n0 > n1 ? 0 : null;
}

/**
 * Human-readable resolution summary for the ledger.
 */
export function describeResolution(status: ResolutionStatus): string {
  if (!status.resolved) return "Unresolved";
  const win = winningOutcome(status);
  return win === 1 ? "YES wins" : win === 0 ? "NO wins" : "Tied (payout 1:1)";
}

/**
 * Collection / position token IDs via the CTF's own pure functions (on-chain).
 */
export async function computeCollectionId(
  parentCollectionId: string,
  conditionId: string,
  indexSet: number
): Promise<string> {
  const ctf = new Contract(CTF, CTF_ABI, provider);
  return (await ctf.getCollectionId(
    parentCollectionId,
    conditionId,
    indexSet
  )) as string;
}

export async function computePositionId(
  collateralToken: string,
  collectionId: string
): Promise<bigint> {
  const ctf = new Contract(CTF, CTF_ABI, provider);
  return (await ctf.getPositionId(collateralToken, collectionId)) as bigint;
}