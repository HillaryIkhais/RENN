/**
 * Static export of the Renn dashboard: bakes the current ledger evidence into
 * a single self-contained HTML file in dist/index.html so the proof surface
 * can be hosted anywhere static (GitHub Pages, Netlify, Vercel, IPFS) with no
 * backend. The embedded snapshot renders immediately; if the exported file is
 * served next to a live /policies and /evidence endpoint the page upgrades to
 * live data, otherwise it stays on the snapshot.
 *
 * Usage: pnpm site:export  ->  dist/index.html (commit or deploy that file)
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reload } from "../src/policy/ledger.js";
import { getResolution, describeResolution } from "../src/polymarket/resolution.js";
import { runAllAttacks } from "../src/policy/attackmode.js";

async function build(): Promise<void> {
  const ROOT = join(import.meta.dirname, "..");
  const HTML = readFileSync(join(ROOT, "dashboard", "index.html"), "utf8");

  const policies = reload();
  const policiesPayload = { policies: [] as unknown[] };
  for (const p of policies) {
    let resText = "n/a";
    let resolved = false;
    let denom = "?";
    try {
      const res = await getResolution(p.conditionId);
      resText = describeResolution(res);
      resolved = res.resolved;
      denom = res.payoutDenominator.toString();
    } catch {
      // leave as n/a
    }
    (policiesPayload.policies as Array<Record<string, unknown>>).push({
      policyId: p.policyId,
      state: p.state,
      marketId: p.marketId,
      question: p.question,
      conditionId: p.conditionId,
      negRisk: p.negRisk,
      positionValueUsdc: p.positionValueUsdc,
      faceValueUsdc: p.faceValueUsdc,
      finality: p.finality,
      obligationHash: p.obligationHash,
      treasury: p.treasuryAddress,
      treasuryLabel: p.treasuryLabel,
      chainId: p.chainId,
      dependsOn: p.dependsOn,
      resolution: { text: resText, resolved, denominator: denom },
      events: p.events,
    });
  }

  const txns: Array<Record<string, unknown>> = [];
  for (const p of policies) {
    for (const e of p.events) {
      if (e.type !== "TRANSACTION") continue;
      txns.push({
        policyId: p.policyId,
        at: e.at,
        step: e.message ?? e.type,
        txHash: e.txHashes?.[0] ?? null,
        txLink: e.txLinks?.[0] ?? null,
        executionId: e.meta?.executionId ?? null,
        sponsored: e.meta?.sponsored ?? false,
        message: e.message ?? "",
      });
    }
  }
  txns.sort((a, b) =>
    String(a.at) < String(b.at) ? 1 : String(a.at) > String(b.at) ? -1 : 0
  );

  // Run all attacks through the real engine and bake the results.
  // In live mode the dashboard will hit /attack endpoints; in static mode
  // these recorded results are replayed — same engine, same refusals.
  const attackResults = await runAllAttacks({ policies });

  const snapshot = {
    at: new Date().toISOString(),
    policiesPayload,
    evidencePayload: { transactions: txns },
    attacksPayload: { at: new Date().toISOString(), results: attackResults },
  };

  const injected = HTML.replace(
    "</head>",
    `<script>window.__RENN_SNAPSHOT__=${JSON.stringify(snapshot)};</script></head>`
  );

  mkdirSync(join(ROOT, "dist"), { recursive: true });
  writeFileSync(join(ROOT, "dist", "index.html"), injected);
  console.log(
    `Exported dist/index.html (${policies.length} policies, ${txns.length} sponsored/recorded transactions)`
  );
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});