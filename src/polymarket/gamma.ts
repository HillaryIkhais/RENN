import { GAMMA_API } from "../config.js";

export interface GammaMarket {
  id: number;
  slug: string;
  question: string;
  conditionId: string;
  endDate: string;
  negRisk: boolean;
  closed: boolean;
  /** JSON-encoded array of CLOB token ids (decimal strings) */
  clobTokenIds: string;
  outcomePrices: string;
  /** JSON-encoded array of outcome labels */
  outcomes: string;
  liquidity: number;
  volume: number;
  volume24hr: number;
  umaResolutionStatus: string | null;
  parentCollectionId: string | null;
  negRiskMarketId: string | null;
  negRiskAdapterAddress: string | null;
}

export async function findMarkets(opts: {
  closed?: boolean;
  negRisk?: boolean;
  endDateMin?: string;
  endDateMax?: string;
  limit?: number;
  order?: string;
  ascending?: boolean;
}): Promise<GammaMarket[]> {
  const params = new URLSearchParams();
  if (opts.closed !== undefined) params.set("closed", String(opts.closed));
  if (opts.negRisk !== undefined) params.set("negRisk", String(opts.negRisk));
  if (opts.endDateMin)
    params.set("end_date_min", opts.endDateMin);
  if (opts.endDateMax)
    params.set("end_date_max", opts.endDateMax);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.order) params.set("order", opts.order);
  if (opts.ascending !== undefined)
    params.set("ascending", String(opts.ascending));

  const url = `${GAMMA_API}/markets?${params}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Gamma API error ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as GammaMarket[];
}

export async function getMarket(id: number): Promise<GammaMarket | null> {
  const url = `${GAMMA_API}/markets?id=${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gamma API error ${res.status}`);
  const rows = (await res.json()) as GammaMarket[];
  return rows[0] ?? null;
}

export function parseTokenIds(m: GammaMarket): [string, string] {
  const ids = JSON.parse(m.clobTokenIds) as string[];
  return [ids[0], ids[1]];
}

export function parseOutcomes(m: GammaMarket): [string, string] {
  const outcomes = JSON.parse(m.outcomes) as string[];
  return [outcomes[0], outcomes[1]];
}

export function parseOutcomePrices(m: GammaMarket): [number, number] {
  const prices = JSON.parse(m.outcomePrices) as string[];
  return [Number(prices[0]), Number(prices[1])];
}