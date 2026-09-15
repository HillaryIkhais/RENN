import { formatUnits } from "ethers";
import { provider } from "../polymarket/contracts.js";
import { USDC } from "../config.js";

/**
 * Funding preflight for the deterministic demo loop.
 *
 * The public Polygon RPC (Bor) rejects state overrides on eth_estimateGas, so
 * exact per-op gas cannot be measured against a zero-balance wallet without
 * broadcasting. We therefore compute a conservative EIP-150 cost model per
 * operation (storage slots, ERC1155/ERC20 accounting, logs, calldata) and run
 * it against LIVE block data:
 *   - eth_gasPrice  -> fee actually suggested by the network right now
 *   - baseFeePerGas -> base fee of the latest block (for spikes)
 *
 * Output: the exact minimum POL the sequence needs (single running total at
 * the current gas price) plus a recommended funding figure with headroom.
 */

export interface OpCost {
  op: string;
  gas: number;
  note: string;
}

const OPS: OpCost[] = [
  { op: "prepareCondition", gas: 120_000, note: "3 x SSTORE (created), 1 log, ~120 words calldata" },
  { op: "splitPosition", gas: 260_000, note: "2 x ERC1155 mint, 2 x collection/position hashing, 2 x SSTORE" },
  { op: "reportPayouts", gas: 110_000, note: "payoutNumerators + payoutDenominator SSTORE, 1 log" },
  { op: "redeemPositions", gas: 240_000, note: "2 x ERC1155 burn, USDC transfer (transferFrom 20k + 2 x SSTORE)" },
  { op: "usdc transfer (route)", gas: 60_000, note: "ERC20 transfer: 2 x SSTORE, checks, calldata" },
];

/** 2.5x headroom on top of the model total to ride fee spikes. */
export const HEADROOM = 2.5;

export interface Preflight {
  blockNumber: number;
  gasPriceGwei: number;
  baseFeeGwei: number;
  forecastGwei: number;
  ops: OpCost[];
  totalGas: number;
  polAtGasPrice: string; // exact minimum at current suggested fee
  polAtBaseFee: string; // exact minimum if fees rise to latest base fee
  polRecommended: string;
  polPriceUsd: number;
  usdcNeeded: string;
  walletUsdc: bigint | null;
  walletPol: number | null;
}

export async function polPriceUsd(): Promise<number> {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=matic-network,polgon-ecosystem-token,px&vs_currencies=usd"
    );
    if (!r.ok) return 0.3;
    const j = (await r.json()) as Record<string, { usd?: number }>;
    const mats = ["matic-network", "polgon-ecosystem-token", "px"].map(
      (k) => j[k]?.usd
    );
    const known = mats.filter((v): v is number => typeof v === "number");
    return known[0] ?? 0.3;
  } catch {
    return 0.3;
  }
}

export async function preflight(opts: {
  demoAmountUsdc: string;
  eoa: string | null;
}): Promise<Preflight> {
  const [latest, feeData, px] = await Promise.all([
    provider.getBlock("latest"),
    provider.getFeeData(),
    polPriceUsd(),
  ]);
  const baseFee = latest?.baseFeePerGas
    ? Number(formatUnits(latest.baseFeePerGas, "gwei"))
    : 0;

  const gasPrice = feeData.gasPrice ?? (await provider.getFeeData()).gasPrice;
  if (!gasPrice) throw new Error("Could not read a gas price from the RPC");
  const gasPriceGwei = Number(formatUnits(gasPrice, "gwei"));
  const totalGas = OPS.reduce((s, o) => s + o.gas, 0);

  const GWEI = 1_000_000_000n;
  const polAtGasPrice = formatUnits(gasPrice * BigInt(totalGas), 18);
  const polAtBaseFee = formatUnits(
    BigInt(Math.round(baseFee)) * GWEI * BigInt(totalGas),
    18
  );
  const polRecommended = formatUnits(
    BigInt(Math.round(gasPriceGwei * HEADROOM)) * GWEI * BigInt(totalGas),
    18
  );

  const walletUsdc =
    opts.eoa && opts.eoa.length === 42
      ? (await fetchWalletUsdc(opts.eoa))
      : null;
  const walletPol = opts.eoa ? Number((await provider.getBalance(opts.eoa))) / 1e18 : null;

  return {
    blockNumber: Number(latest?.number ?? 0),
    gasPriceGwei,
    baseFeeGwei: baseFee,
    forecastGwei: Math.round(gasPriceGwei * HEADROOM),
    ops: OPS,
    totalGas,
    polAtGasPrice,
    polAtBaseFee,
    polRecommended,
    polPriceUsd: px,
    usdcNeeded: opts.demoAmountUsdc,
    walletUsdc,
    walletPol,
  };
}

export function renderPreflight(p: Preflight): string {
  const perOp = p.ops
    .map((o) => `    ${o.op.padEnd(24)} ${String(o.gas).padStart(7)} gas  ${o.note}`)
    .join("\n");
  const minUsd = (Number(p.polAtGasPrice) * p.polPriceUsd).toFixed(3);
  const recUsd = (Number(p.polRecommended) * p.polPriceUsd).toFixed(3);
  const walletUsdc =
    p.walletUsdc === null
      ? "not set"
      : `${Number(formatUnits(p.walletUsdc, 6)).toFixed(2)} USDC`;
  const walletPol = p.walletPol === null ? "n/a" : p.walletPol.toFixed(4);
  const lines = [
    `Block #${p.blockNumber}  live gasPrice=${p.gasPriceGwei.toFixed(1)} gwei  baseFee=${p.baseFeeGwei.toFixed(1)} gwei  POL/USD~$${p.polPriceUsd}`,
    `\nGas model (EIP-150, conservative; public RPC cannot eth_estimateGas a zero-balance wallet):`,
    perOp,
    `\n  Demo sequence total:  ${p.totalGas.toLocaleString()} gas`,
    `  EXACT minimum POL     ${p.polAtGasPrice}  (at current ${p.gasPriceGwei.toFixed(0)} gwei)  ~$${minUsd}`,
    `  min vs latest baseFee ${p.polAtBaseFee}  (~${p.baseFeeGwei.toFixed(0)} gwei)`,
    `  RECOMMENDED funding   ${p.polRecommended}  (x${HEADROOM} headroom @ ${p.forecastGwei} gwei)  ~$${recUsd}`,
    `\n  USDC needed:          ${p.usdcNeeded} (demo principal; routed to treasury at the end)`,
    `  Wallet balances:      ${walletPol} POL / ${walletUsdc}`,
    `\nNet cost to run the demo = gas only. The ${p.usdcNeeded} USDC principal is not consumed;`,
    `it is routed to the precommitted treasury as the product's whole point.`,
    `Do not put anything else in the demo wallet. It is a throwaway key.`,
  ];
  return lines.join("\n");
}

async function fetchWalletUsdc(address: string): Promise<bigint> {
  const { Contract } = await import("ethers");
  const c = new Contract(
    USDC,
    ["function balanceOf(address) external view returns (uint256)"],
    provider
  );
  return (await c.balanceOf(address)) as bigint;
}

export function zeroValueApproveStep(spender: string): {
  contractAddress: string;
  functionName: string;
  functionArgs: unknown[];
  abi: string;
} {
  return {
    contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
    functionName: "approve",
    functionArgs: [spender, 0],
    abi: JSON.stringify([
      "function approve(address spender, uint256 amount) external returns (bool)",
    ]),
  };
}