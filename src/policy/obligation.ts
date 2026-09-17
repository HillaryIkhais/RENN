import { keccak256, toUtf8Bytes } from "ethers";
import { CTF } from "../config.js";
import type { RedemptionKind } from "./types.js";

/**
 * The frozen obligation envelope. Exactly these fields determine settlement;
 * none of them may change after LOCK. Its hash is recorded at arm time and
 * re-verified before every execution so that `LOCKED OBLIGATION != EDITABLE
 * AGENT INTENT` (KeeperHub executes exactly what was authored; Renn refuses
 * to let the settlement target drift).
 */
export function obligationEnvelope(input: {
  conditionId: string;
  parentCollectionId: string;
  beneficiary: string;
  faceValueUsdc: string;
  finality: "on-chain-ctf";
  redemptionKind: RedemptionKind;
  dependsOn?: string;
}): string {
  return keccak256(
    toUtf8Bytes(
      JSON.stringify({
        conditionId: input.conditionId,
        parentCollectionId: input.parentCollectionId,
        beneficiary: input.beneficiary,
        faceValueUsdc: input.faceValueUsdc,
        trigger: "winner",
        finality: input.finality,
        settlementCallee: CTF,
        redemption: input.redemptionKind,
        ...(input.dependsOn ? { dependsOn: input.dependsOn } : {}),
      })
    )
  );
}