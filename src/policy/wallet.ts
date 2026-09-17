import { JsonRpcProvider, Contract } from "ethers";
import { RPC_URL, USDC } from "../config.js";

/**
 * Org-wallet value-leg measurement. The org wallet executes through KeeperHub
 * with sponsored gas but must hold the USDC it settles. Renn never claims a
 * value leg is complete; this module MEASURES the on-chain balance at demo /
 * export time so the dashboard says "0 USDC measured on Polygon" instead of
 * just "0 USDC claimed".
 */

export const ORG_WALLET = "0x9f7de2b79d93adb3d3ef6501ca6d8c8c00a2e6fc";

const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
] as const;

export interface WalletState {
  address: string;
  usdc: string;
  pol: string;
  at: string;
  ok: boolean;
  error?: string;
}

let cached: { state: WalletState; at: number } | null = null;

export async function liveOrgWalletState(ttlMs = 60_000): Promise<WalletState> {
  if (cached && Date.now() - cached.at < ttlMs) {
    return cached.state;
  }
  const state = await measure();
  cached = { state, at: Date.now() };
  return state;
}

async function measure(): Promise<WalletState> {
  try {
    const provider = new JsonRpcProvider(RPC_URL);
    const usdc = new Contract(USDC, USDC_ABI, provider);
    const [bal, pol] = await Promise.all([
      usdc.balanceOf(ORG_WALLET),
      provider.getBalance(ORG_WALLET),
    ]);
    return {
      address: ORG_WALLET,
      usdc: (Number(bal) / 1e6).toFixed(2),
      pol: (Number(pol) / 1e18).toFixed(6),
      at: new Date().toISOString(),
      ok: true,
    };
  } catch (err) {
    return {
      address: ORG_WALLET,
      usdc: "?",
      pol: "?",
      at: new Date().toISOString(),
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}