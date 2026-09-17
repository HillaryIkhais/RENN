import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { reload } from "../src/policy/ledger.js";
import { getResolution, describeResolution } from "../src/polymarket/resolution.js";
import { runAttack, runAllAttacks, ATTACK_IDS } from "../src/policy/attackmode.js";
import { liveOrgWalletState } from "../src/policy/wallet.js";

const PORT = Number(process.env.PORT ?? 8787);
const ROOT = join(import.meta.dirname, "..", "dashboard");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * Aggregate real on-chain evidence: every TRANSACTION event recorded in the
 * ledger across all policies. This is what the dashboard's LIVE MAINNET PROOF
 * strip renders — never placeholders, only recorded execution ids + hashes.
 */
async function liveEvidence() {
  const policies = reload();
  const txns: Array<{
    policyId: string;
    at: string;
    step: string;
    txHash: string | null;
    txLink: string | null;
    executionId: string | null;
    sponsored: boolean;
    message: string;
  }> = [];
  for (const p of policies) {
    for (const e of p.events) {
      if (e.type !== "TRANSACTION") continue;
      const hash = e.txHashes?.[0] ?? null;
      const link = e.txLinks?.[0] ?? null;
      const executionId = (e.meta?.executionId as string | undefined) ?? null;
      const sponsored = (e.meta?.sponsored as boolean | undefined) ?? false;
      txns.push({
        policyId: p.policyId,
        at: e.at,
        step: e.message ?? e.type,
        txHash: hash,
        txLink: link,
        executionId,
        sponsored,
        message: e.message ?? "",
      });
    }
  }
  txns.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return txns;
}

async function livePolicies() {
  const policies = reload();
  const rows = [];
  for (const p of policies) {
    let res: { resolved: boolean; payoutDenominator: bigint; payoutNumerators: [bigint, bigint] } | null = null;
    let resText = "n/a";
    try {
      res = await getResolution(p.conditionId);
      resText = describeResolution(res);
    } catch {
      // leave as n/a
    }
    rows.push({
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
      resolution: { text: resText, resolved: res?.resolved ?? false, denominator: res?.payoutDenominator?.toString() ?? "?" },
      events: p.events,
    });
  }
  return rows;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/policies") {
      const rows = await livePolicies();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ at: new Date().toISOString(), policies: rows }, null, 2));
      return;
    }
    if (url.pathname === "/evidence") {
      const txns = await liveEvidence();
      const orgWallet = await liveOrgWalletState();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ at: new Date().toISOString(), transactions: txns, orgWallet }, null, 2));
      return;
    }
    if (url.pathname === "/attack") {
      const name = url.searchParams.get("name");
      if (!name || !ATTACK_IDS.includes(name as any)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `invalid attack; available: ${ATTACK_IDS.join(", ")}` }));
        return;
      }
      const policies = reload();
      const result = await runAttack(name, { policies });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ at: new Date().toISOString(), result }, null, 2));
      return;
    }
    if (url.pathname === "/attacks") {
      const policies = reload();
      const results = await runAllAttacks({ policies });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
      return;
    }

    let filePath = join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
    if (!existsSync(filePath) || extname(filePath) === "") {
      filePath = join(ROOT, "index.html");
    }
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const body = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`Renn dashboard: http://localhost:${PORT}`);
});