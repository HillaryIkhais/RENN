import { Contract, Wallet, hexlify, parseUnits, randomBytes } from "ethers";
import { CTF, USDC } from "../config.js";
import { CTF_ABI, provider } from "./contracts.js";

/**
 * Path A demo engine: create our own CTF condition on the real Polymarket CTF
 * contract, split USDC into YES shares, then resolve it on demand and redeem.
 * Every step is a real Polygon mainnet transaction using the same CTF that
 * powers Polymarket's markets.
 */
export class DemoEngine {
  constructor(private readonly signer: Wallet) {}

  private ctf(): Contract {
    return new Contract(CTF, CTF_ABI, this.signer);
  }

  async prepareCondition(params: {
    parentCollectionId?: string;
    outcomeSlotCount?: number;
    conditionId?: string;
  }): Promise<{ conditionId: string; txHash: string }> {
    const conditionId =
      params.conditionId ?? hexlify(randomBytes(32));
    const ctf = this.ctf();
    const tx = await ctf.prepareCondition(
      this.signer.address,
      ethersZero(params.parentCollectionId),
      conditionId,
      params.outcomeSlotCount ?? 2
    );
    const receipt = await tx.wait();
    return { conditionId, txHash: receipt.hash };
  }

  async split(params: {
    conditionId: string;
    parentCollectionId?: string;
    partition?: number[];
    amountUsdc: string;
  }): Promise<{ txHash: string; yesTokenId: bigint }> {
    const ctf = this.ctf();
    const parent = ethersZero(params.parentCollectionId);
    const partition = params.partition ?? [1, 2];
    const amount = parseUnits(params.amountUsdc, 6);
    const tx = await ctf.splitPosition(
      USDC,
      parent,
      params.conditionId,
      partition,
      amount
    );
    const receipt = await tx.wait();
    const collectionId = await this.collectionId(
      parent,
      params.conditionId,
      1
    );
    const yesTokenId = await this.positionId(USDC, collectionId);
    return { txHash: receipt.hash, yesTokenId };
  }

  async resolve(params: {
    conditionId: string;
    payoutNumerators: [number, number];
  }): Promise<string> {
    const ctf = this.ctf();
    const tx = await ctf.reportPayouts(
      params.conditionId,
      params.payoutNumerators
    );
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async classicRedeem(params: {
    conditionId: string;
    parentCollectionId?: string;
    indexSets?: number[];
  }): Promise<string> {
    const ctf = this.ctf();
    const tx = await ctf.redeemPositions(
      USDC,
      ethersZero(params.parentCollectionId),
      params.conditionId,
      params.indexSets ?? [1, 2]
    );
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async balanceOf(tokenId: bigint, account = this.signer.address): Promise<bigint> {
    const ctf = new Contract(CTF, CTF_ABI, provider);
    return (await ctf.balanceOf(account, tokenId)) as bigint;
  }

  private async collectionId(
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

  private async positionId(
    collateral: string,
    collectionId: string
  ): Promise<bigint> {
    const ctf = new Contract(CTF, CTF_ABI, provider);
    return (await ctf.getPositionId(collateral, collectionId)) as bigint;
  }
}

function ethersZero(hex?: string): string {
  return hex ?? `0x${"00".repeat(32)}`;
}