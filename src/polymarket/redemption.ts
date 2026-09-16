import { CTF, NEG_RISK_ADAPTER, USDC } from "../config.js";
import { CTF_ABI, NEG_RISK_ADAPTER_ABI, jsonAbi } from "./contracts.js";

/**
 * Calldata builders for Polymarket redemption, used to configure the
 * KeeperHub `web3/write-contract` steps. Each returns the JSON-ready
 * `{ to, abi, functionName, args }` consumed by the workflow composer.
 */

export function approveNegRiskAdapter(): { to: string; abi: string; functionName: string; args: unknown[] } {
  return {
    to: CTF,
    abi: jsonAbi([
      "function setApprovalForAll(address operator, bool approved) external",
    ]),
    functionName: "setApprovalForAll",
    args: [NEG_RISK_ADAPTER, true],
  };
}

/**
 * Standard (non-neg-risk) redemption: burns winning YES/NO tokens in the
 * condition and credits the underlying collateral (USDC) to the caller.
 */
export function classicRedeem(params: {
  collateralToken?: string;
  parentCollectionId: string;
  conditionId: string;
  indexSets?: number[];
}): { to: string; abi: string; functionName: string; args: unknown[] } {
  return {
    to: CTF,
    abi: jsonAbi(CTF_ABI),
    functionName: "redeemPositions",
    args: [
      params.collateralToken ?? USDC,
      params.parentCollectionId,
      params.conditionId,
      params.indexSets ?? [1, 2],
    ],
  };
}

/**
 * NegRisk redemption: redeems a YES/NO pair through the legacy NegRisk adapter.
 * `amounts` = [yesTokenAmount, noTokenAmount] in raw units; the adapter
 * converts the winning leg into collateral.
 */
export function negRiskRedeem(params: {
  conditionId: string;
  amounts: [bigint, bigint];
}): { to: string; abi: string; functionName: string; args: unknown[] } {
  return {
    to: NEG_RISK_ADAPTER,
    abi: jsonAbi(NEG_RISK_ADAPTER_ABI),
    functionName: "redeemPositions",
    args: [params.conditionId, params.amounts.map(String)],
  };
}

export function erc20Transfer(params: {
  token: string;
  recipient: string;
  amountRaw: string;
}): { to: string; abi: string; functionName: string; args: unknown[] } {
  return {
    to: params.token,
    abi: jsonAbi([
      "function transfer(address recipient, uint256 amount) external returns (bool)",
    ]),
    functionName: "transfer",
    args: [params.recipient, params.amountRaw],
  };
}