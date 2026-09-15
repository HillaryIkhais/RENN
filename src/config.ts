import "dotenv/config";

export const CHAIN_ID = 137;
export const RPC_URL =
  process.env.POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com";

export const USDC = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
export const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
export const WETH = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
export const PMCT = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // placeholder, resolved by contract query when needed

export const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
export const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";
export const CTF_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
export const NEG_RISK_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
export const AUTO_REDEEMER = "0xa1200000d0002264C9a1698e001292D00E1b00af";

export const BASE_CHAIN_ID = 8453;
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Wallet that holds the Polymarket positions. On KeeperHub this is the
// organization's Turnkey wallet; locally it can be a private key.
export const EOA_PRIVATE_KEY = process.env.EOA_PRIVATE_KEY;
export const EOA_ADDRESS = process.env.EOA_ADDRESS;

// KeeperHub API surface.
export const KEEPERHUB_API_BASE =
  process.env.KEEPERHUB_API_BASE ?? "https://app.keeperhub.com";
export const KEEPERHUB_API_KEY = process.env.KEEPERHUB_API_KEY;

export const MIN_POL_BALANCE_FOR_GAS = parseFloat(
  process.env.MIN_POL_BALANCE_FOR_GAS ?? "0.05"
);

export const GAMMA_API = "https://gamma-api.polymarket.com";

// Storage for the policy ledger.
export const DATA_DIR = process.env.DATA_DIR ?? ".data";

export function requireEnv(name: keyof typeof process.env): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}