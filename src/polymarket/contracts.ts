import { Fragment, JsonRpcProvider, Contract } from "ethers";
import { NEG_RISK_ADAPTER, RPC_URL } from "../config.js";

/**
 * Expand ethers human-readable function signatures into the canonical JSON
 * ABI objects KeeperHub's direct-execution routes parse. Those routes
 * JSON-deserialize the `abi` field and match entries by `type: "function"`;
 * human-readable fragments are not expanded on that path.
 */
export function jsonAbi(fragments: readonly string[]): string {
  return JSON.stringify(
    fragments.map((f) => JSON.parse(Fragment.from(f).format("json")))
  );
}

export const provider = new JsonRpcProvider(RPC_URL, 137, {
  staticNetwork: true,
});

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
] as const;

export const ERC1155_ABI = [
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address account, address operator) external view returns (bool)",
  "function balanceOf(address account, uint256 id) external view returns (uint256)",
] as const;

/**
 * Gnosis Conditional Token Framework (CTF) - the ERC1155 used by Polymarket.
 * https://github.com/gnosis/conditional-tokens-contracts
 */
export const CTF_ABI = [
  "function prepareCondition(address reporter, bytes32 parentCollectionId, bytes32 conditionId, uint256 outcomeSlotCount) external",
  "function reportPayouts(bytes32 questionId, uint256[] payoutNumerators) external",
  "function payoutDenominator(bytes32 conditionId) external view returns (uint256)",
  "function payoutNumerators(bytes32 conditionId, uint256 index) external view returns (uint256)",
  "function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) external pure returns (bytes32)",
  "function getPositionId(address collateralToken, bytes32 collectionId) external pure returns (uint256)",
  "function splitPosition(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount) external",
  "function mergePositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount) external",
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external",
  "function balanceOf(address account, uint256 id) external view returns (uint256)",
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address account, address operator) external view returns (bool)",
] as const;

/**
 * Legacy Polymarket NegRisk adapter. Redeems winning YES/NO pairs only once
 * the condition is resolved (payoutDenominator > 0). Requires the holder to
 * have granted CTF.setApprovalForAll(adapter, true).
 */
export const NEG_RISK_ADAPTER_ABI = [
  "function redeemPositions(bytes32 conditionId, uint256[] amounts) external",
  "function wcol() external view returns (address)",
] as const;

export async function wcolAddress(): Promise<string> {
  const adapter = new Contract(
    NEG_RISK_ADAPTER,
    NEG_RISK_ADAPTER_ABI,
    provider
  );
  return (await adapter.wcol()) as string;
}