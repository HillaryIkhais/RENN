export type PolicyState =
  | "ARMED"
  | "LOCKED"
  | "RESOLVED"
  | "EXECUTING"
  | "SETTLED"
  | "FAILED"
  | "EXPIRED";

export type RedemptionKind = "classic" | "negRisk";

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
  /** precommitted destination */
  treasuryAddress: string;
  treasuryLabel?: string;
  redemptionKind: RedemptionKind;
  /** KeeperHub workflow id once composed/created */
  workflowName?: string;
  workflow?: unknown;
  notes?: string;
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
  | "RESOLVED"
  | "EXECUTING"
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