export type PolicyState =
  | "ARMED"
  | "LOCKED"
  | "WAITING_FINALITY"
  | "RESOLVED"
  | "EXECUTING"
  | "VERIFYING"
  | "SETTLED"
  | "FAILED"
  | "EXPIRED";

export type RedemptionKind = "classic" | "negRisk";

/**
 * Renn models an obligation, not a payout: WHO gets HOW MUCH, under WHICH
 * final on-chain condition, via WHICH immutable execution envelope.
 */
export interface PolicyInput {
  marketId: number;
  question: string;
  conditionId: string;
  parentCollectionId: string;
  negRisk: boolean;
  resolved?: boolean;
  payoutNumerators?: [number, number];
  /** USDC already held by the executing wallet for this policy (UI units) */
  positionValueUsdc?: string;
  /** precommitted destination (beneficiary in obligation terms) */
  treasuryAddress: string;
  treasuryLabel?: string;
  /** obligation face value in USDC, frozen at arm time */
  faceValueUsdc?: string;
  /** finality requirement: only execute once on-chain payout state is final */
  finality?: "on-chain-ctf";
  /** keccak(utf8(JSON of the frozen obligation envelope)): immutability proof */
  obligationHash?: string;
  redemptionKind: RedemptionKind;
  /** KeeperHub workflow id once composed/created */
  workflowName?: string;
  workflow?: unknown;
  notes?: string;
  /** obligation chain this obligation belongs to (settlement proof is executable state) */
  chainId?: string;
  /** preceding obligation whose PROVEN_SETTLED state is the unlock condition for this one */
  dependsOn?: string;
}

/**
 * Immutable, independently verified settlement proof. This is the
 * "authorization object": once an obligation is PROVEN_SETTLED, this record is
 * persisted and a chained obligation references it (never merely
 * `state === SETTLED`) as its unlock condition.
 */
export interface SettlementProof {
  policyId: string;
  /** the exact distribution transaction that moved value to the beneficiary */
  settlementTxHash: string;
  beneficiary: string;
  /** exact obligated amount in USDC UI units */
  amountUsdc: string;
  /** ERC20 token the settlement moved (USDC on Polygon) */
  tokenAddress: string;
  conditionId: string;
  /** the frozen obligation this proof discharges */
  obligationHash: string;
  executionId?: string;
  verifiedAt: string;
  /** keccak256 of the canonical proof payload — tamper-evident id */
  verificationId: string;
}

export interface Policy extends PolicyInput {
  policyId: string;
  state: PolicyState;
  createdAt: string;
  updatedAt: string;
  events: PolicyEvent[];
  /** persisted once the obligation closes as PROVEN_SETTLED */
  proof?: SettlementProof;
}

export type PolicyEventType =
  | "ARMED"
  | "LOCKED"
  | "WAITING_FINALITY"
  | "RESOLVED"
  | "EXECUTING"
  | "VERIFYING"
  | "SETTLED"
  | "PROOF"
  | "FAILED"
  | "EXPIRED"
  | "TRANSACTION"
  | "DETECTED"
  | "NOTE";

export interface PolicyEvent {
  at: string;
  type: PolicyEventType;
  state?: PolicyState;
  message?: string;
  txHashes?: string[];
  txLinks?: string[];
  meta?: Record<string, unknown>;
}

export interface LedgerEvent {
  policyId: string;
  at: string;
  event: PolicyEvent;
}