import { randomUUID } from "node:crypto";
import { KEEPERHUB_API_BASE, KEEPERHUB_API_KEY } from "../config.js";

/**
 * KeeperHub client, wired to the direct-execution API that ships in the
 * KeeperHub repo itself (KEEP-828 / KEEP-1927 contract):
 *
 *   POST /api/execute/contract-call   single contract call (write)
 *       body: { contractAddress, chainId|network, functionName,
 *              functionArgs (JSON string), abi? (JSON string), value?,
 *              priorityFeeGwei?, simulate?: boolean }
 *       headers: Authorization: Bearer kh_..., Idempotency-Key on writes
 *   GET  /api/execute/{executionId}/status
 *
 * Safe write pattern (per KeeperHub docs and the route source):
 *   1. call with simulate: true -> stop unless success && wouldRevert === false
 *   2. broadcast with a FRESH idempotency key
 *   3. poll /status until completed | failed
 */

export interface ContractCallInput {
  contractAddress: string;
  chainId: number | string;
  functionName: string;
  /** args for the ABI function, JSON-serialized when this hits the API */
  functionArgs?: unknown[];
  /** full ABI JSON string; optional, the API can auto-fetch */
  abi?: string;
  value?: string;
  priorityFeeGwei?: string;
}

export interface SimulateSuccess {
  success: true;
  wouldRevert: false;
}
export interface SimulateFailure {
  success: false;
  wouldRevert: true;
  failureKind?: string;
  revertReason?: string;
}
export type SimulateResult = SimulateSuccess | SimulateFailure;

export type ExecutionStatus =
  | "pending"
  | "running"
  | "unconfirmed"
  | "completed"
  | "failed";

export interface ExecuteResponse {
  executionId: string;
  status: ExecutionStatus;
  transactionHash?: string | null;
  transactionLink?: string | null;
  error?: string;
}

export interface ExecutionStatusResponse {
  executionId: string;
  status: ExecutionStatus;
  type: string;
  transactionHash: string | null;
  transactionLink: string | null;
  sponsored: boolean;
  receipts: unknown[];
  result: unknown;
  error: string | null;
  gasUsedWei?: string | null;
  estimatedCostUsd?: string | null;
  network: string | null;
  createdAt: string;
  completedAt: string | null;
}

const TERMINAL: ExecutionStatus[] = ["completed", "failed"];

export function hasKeeperHubKey(): boolean {
  return Boolean(KEEPERHUB_API_KEY);
}

export function requireKeeperHubKey(): string {
  if (!KEEPERHUB_API_KEY) {
    throw new Error(
      "KEEPERHUB_API_KEY is not set. Create an organisation API key at " +
        "https://app.keeperhub.com (avatar -> API Keys -> Organisation tab); keys start with kh_. " +
        "Note: user keys (wfb_) authenticate webhook triggers and are not interchangeable."
    );
  }
  return KEEPERHUB_API_KEY;
}

async function khFetch(
  path: string,
  init?: { method?: string; body?: unknown; idempotencyKey?: string }
): Promise<{ response: Response; body: unknown }> {
  const key = requireKeeperHubKey();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
  if (init?.idempotencyKey) {
    headers["Idempotency-Key"] = init.idempotencyKey;
  }
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${KEEPERHUB_API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers,
    body:
      init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  return { response, body };
}

export function jsonArgs(args: unknown[] | undefined): string | undefined {
  return args === undefined ? undefined : JSON.stringify(args);
}

/** GET /api/user/wallet -> EVM + Solana addresses for the org Turnkey wallet. */
export async function discoverWallet(): Promise<{
  walletAddress: string;
  solanaAddress: string | null;
}> {
  const { response, body } = await khFetch("/api/user/wallet");
  if (!response.ok) {
    throw new Error(`discoverWallet failed (${response.status}): ${JSON.stringify(body)}`);
  }
  const w = body as { walletAddress?: string; solanaAddress?: string | null };
  if (!w.walletAddress) {
    throw new Error(`No EVM wallet address for this organisation: ${JSON.stringify(body)}`);
  }
  return { walletAddress: w.walletAddress, solanaAddress: w.solanaAddress ?? null };
}

/** Dry-run contract call via the API. Only believes success with wouldRevert false. */
export async function simulateContractCall(
  input: ContractCallInput
): Promise<SimulateResult> {
  const { response, body } = await khFetch("/api/execute/contract-call", {
    method: "POST",
    body: {
      ...input,
      chainId: String(input.chainId),
      functionArgs: jsonArgs(input.functionArgs),
      simulate: true,
    },
  });
  if (!response.ok) {
    throw new Error(`simulate failed (${response.status}): ${JSON.stringify(body)}`);
  }
  const result = body as SimulateResult;
  if (!("success" in result) || result.success) {
    return result;
  }
  return result as SimulateFailure;
}

/** Broadcast a write. Requires a FRESH idempotency key per logical action. */
export async function executeContractCall(
  input: ContractCallInput,
  idempotencyKey: string
): Promise<{ response: Response; data: ExecuteResponse }> {
  const { response, body } = await khFetch("/api/execute/contract-call", {
    method: "POST",
    idempotencyKey,
    body: {
      ...input,
      chainId: String(input.chainId),
      functionArgs: jsonArgs(input.functionArgs),
    },
  });
  return { response, data: body as ExecuteResponse };
}

/** GET /api/execute/{executionId}/status */
export async function getExecutionStatus(
  executionId: string
): Promise<ExecutionStatusResponse> {
  const { response, body } = await khFetch(`/api/execute/${executionId}/status`);
  if (!response.ok) {
    throw new Error(`status failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body as ExecutionStatusResponse;
}

/**
 * The safe loop: simulate -> abort unless clear -> broadcast with fresh key ->
 * poll to a terminal status (completed is success; failed and system_error are
 * not; pending/running/unconfirmed are not terminal).
 */
export async function runContractCall(
  input: ContractCallInput,
  opts: { label?: string; onStatus?: (s: ExecutionStatusResponse) => void } = {}
): Promise<ExecutionStatusResponse> {
  const label = opts.label ?? input.functionName;
  const simulation = await simulateContractCall(input);
  if (!simulation.success || simulation.wouldRevert) {
    throw new Error(
      `Preflight rejected ${label}: success=${simulation.success} wouldRevert=${simulation.wouldRevert} ` +
        `${"revertReason" in simulation && simulation.revertReason ? `(${simulation.revertReason})` : ""}`
    );
  }
  console.log(`simulate ${label}: success=true wouldRevert=false (dry run passed)`);

  const { response, data } = await executeContractCall(
    input,
    `${label.replace(/[^\x20-\x7E]/g, "_")}:${randomUUID()}`
  );
  if (!response.ok) {
    throw new Error(`execute ${label} failed (${response.status}): ${JSON.stringify(data)}`);
  }
  console.log(
    `${label}: executionId=${data.executionId} status=${data.status}` +
      (data.transactionLink ? ` ${data.transactionLink}` : "")
  );
  if (TERMINAL.includes(data.status)) {
    return getExecutionStatus(data.executionId);
  }

  let pollSeconds = 0;
  const pollHint = response.headers.get("X-Poll-Interval-Hint");
  const intervalMs = pollHint ? Number(pollHint) * 1000 : 2000;
  while (pollSeconds < 120_000) {
    await sleep(intervalMs);
    pollSeconds += intervalMs;
    const status = await getExecutionStatus(data.executionId);
    opts.onStatus?.(status);
    console.log(
      `${label}: poll status=${status.status}` +
        (status.transactionLink ? ` ${status.transactionLink}` : "")
    );
    if (TERMINAL.includes(status.status)) {
      return status;
    }
  }
  throw new Error(`${label}: timed out polling execution ${data.executionId}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}