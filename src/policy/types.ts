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

export interface Policy extends PolicyInput {
  policyId: string;
  state: PolicyState;
  createdAt: string;
  updatedAt: string;
  events: PolicyEvent[];
}

export type PolicyEventType =
  | "ARMED"
  | "LOCKED"
  | "WAITING_FINALITY"
  | "RESOLVED"
  | "EXECUTING"
  | "VERIFYING"
  | "SETTLED"
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