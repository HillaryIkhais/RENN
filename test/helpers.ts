import { keccak256, toUtf8Bytes } from "ethers";
import { obligationEnvelope } from "../src/policy/obligation.js";
import type { Policy, PolicyEvent } from "../src/policy/types.js";

export const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
export const USDC_ADDRESS = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
export const OTHER_TOKEN = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
export const BENEFICIARY = "0x0716207e349F9928103aA2D6Cca2EE9BCC0174e1";
export const OTHER_BENEFICIARY = "0x000000000000000000000000000000000000dEaD";
export const CONDITION_A = `0x${"11".repeat(32)}`;
export const CONDITION_B = `0x${"22".repeat(32)}`;

export const TRANSFER_TOPIC = keccak256(toUtf8Bytes("Transfer(address,address,uint256)"));

function padTopic(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

export function transferLog(input: {
  token: string;
  from: string;
  to: string;
  amountBaseUnits: bigint;
}): { address: string; topics: string[]; data: string } {
  return {
    address: input.token,
    topics: [TRANSFER_TOPIC, padTopic(input.from), padTopic(input.to)],
    data: `0x${input.amountBaseUnits.toString(16).padStart(64, "0")}`,
  };
}

export function fakePolicy(overrides: Partial<Policy> = {}): Policy {
  const merged: Policy = {
    policyId: "policy-test",
    state: "SETTLED",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    events: [],
    marketId: 0,
    question: "test obligation",
    conditionId: CONDITION_A,
    parentCollectionId: ZERO32,
    negRisk: false,
    treasuryAddress: BENEFICIARY,
    faceValueUsdc: "1",
    positionValueUsdc: "1",
    finality: "on-chain-ctf",
    redemptionKind: "classic",
    ...overrides,
  };
  if (!merged.obligationHash) {
    merged.obligationHash = obligationEnvelope({
      conditionId: merged.conditionId,
      parentCollectionId: merged.parentCollectionId,
      beneficiary: merged.treasuryAddress,
      faceValueUsdc: merged.faceValueUsdc ?? merged.positionValueUsdc ?? "0",
      finality: "on-chain-ctf",
      redemptionKind: merged.redemptionKind,
      ...(merged.dependsOn ? { dependsOn: merged.dependsOn } : {}),
    });
  }
  return merged;
}

export function distributionEvent(txHash: string, executionId = "exec-dist"): PolicyEvent {
  return {
    at: new Date(0).toISOString(),
    type: "TRANSACTION",
    txHashes: [txHash],
    txLinks: [`https://polygonscan.com/tx/${txHash}`],
    message: "route face value via KeeperHub",
    meta: { executionId, sponsored: true, kind: "distribution" },
  };
}
