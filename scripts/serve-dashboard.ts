import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { reload } from "../src/policy/ledger.js";
import { getResolution, describeResolution } from "../src/polymarket/resolution.js";

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
      treasury: p.treasuryAddress,
      treasuryLabel: p.treasuryLabel,
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
  console.log(`Consequence dashboard: http://localhost:${PORT}`);
});