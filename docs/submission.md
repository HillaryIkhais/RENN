# Consequence — DoraHacks Submission (Main Track + Arc Bounty)

**Category:** Agent Economy — deterministic, on-chain-triggered financial execution
**Team:** nobody-vulnerability (repo: `keeperhub-polymarket`)
**Bonus submission:** Arc Testnet chain-registration (issue #2230) merged via PR.

## Elevator pitch (one paragraph)

Prediction markets are unmatched at one thing that agents are meant to fix:
turning a human judgment into an enforceable financial response. Today the
"response" half is manual, delayed, and unreliable — winning shares rot in
wallets instead of becoming USDC in a treasury. Consequence inverts the
responsibility: an operator precommits what happens to the money the moment
the market resolves. On resolution day, KeeperHub executes the redemption and
the routing, and the entire loop — arm, hold, resolve, execute, settle — is an
append-only, receipt-backed policy ledger. The predicate that moves money is a
single on-chain fact: `payoutDenominator(conditionId) != 0` on Polymarket's
Conditional Tokens contract.

## The problem, precisely

1. **Collection is broken by default.** When Polymarket resolves a condition it
   does *not* sweep shares into the trader's wallet. Winning positions must be
   redeemed via the CTF (or NegRisk adapter / exchange settlement), then the
   collateral is only returned after redemption. None of that happens by itself.
2. **Timing is everything and humans are bad at it.** Redemption is
   time-sensitive and mechanical. The window after resolution is exactly when
   a person in a winning position is least likely to be watching.
3. **Money routing is where policy lives.** "Take the payout, send it to X"
   is the actual decision. It should be made once, in advance, auditable,
   and then — never re-litigated.

## What we built

| Layer | Component | Address |
|-------|-----------|---------|
| Market truth | Gamma API client + on-chain resolution detector | `src/polymarket/` |
| Redemption | CTF / NegRiskAdapter redemption flows, tested selectors | `src/polymarket/redemption.ts` |
| Execution | KeeperHub workflow composer (read gate, redeem, transfer) | `src/keeperhub/workflow.ts` |
| Policy | Append-only state machine (ARMED to SETTLED) | `src/policy/` |
| Surface | CLI (`arm`, `status`, `watch`, `execute`, `demo:*`) + live console | `src/index.ts`, `dashboard/` |
| Demo | Deterministic, real-mainnet event that reuses Polymarket's CTF | `src/polymarket/demo-engine.ts` |

## How KeeperHub is the secret ingredient

Consequence deliberately refuses to sign transactions. The stage that is
actually executing money is an ordinary, inspectable KeeperHub workflow:

1. `web3/read-contract` — `payoutDenominator(conditionId)` on
   `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`
2. `Condition` gate — proceed only if the payload is non-zero (keyholders can
   read the gating expression in the workflow JSON)
3. `web3/write-contract` — `redeemPositions(...)` redemption path
4. `web3/transfer-token` — route the winning USDC to the precommitted treasury

This means the "agent" is repurposed correctly: it does not decide, it
executes. The decision was the policy; the workflow is the trust boundary; the
ledger is the audit. Operator custody rules, gas handling and receipt/status
tracking all come from KeeperHub — Consequence contributes the resolution
trigger, the redemption math, and the precommitment contract around it.

## Proof it works

- All four Polymarket contracts confirmed live on Polygon mainnet (chain 137).
- CTF ABI validated against the live contract via read calls.
- Resolution detection verified: `payoutDenominator == 1` on resolved markets,
  `0` on the still-pending September 2026 FOMC market.
- Policy ledger + workflow composer exercised through `arm` / `status` and the
  dashboard at `/policies`.
- Deterministic demo runs the full loop with real transactions: split USDC,
  resolve, redeem, route.

## Live event

The flagship market, the September 2026 FOMC rate decision (market 2252243,
~$48M volume, resolves September 16 2026), resolves inside the hackathon
window, letting the on-chain live demo play on a market the whole world is
watching.

## What it takes to run

```bash
pnpm install
cp .env.example .env            # add EOA_PRIVATE_KEY + TREASURY_ADDRESS
pnpm demo:bootstrap && pnpm demo:resolve && pnpm demo:distribute
pnpm dashboard                  # live console: http://localhost:8787
```

No server, no bot network, no cloud dependency. One EOA wallet, one KeeperHub
org, the observability of a JSONL file.

## Security and trust

- Money only moves on an on-chain predicate; a closed-but-unresolved market
  never triggers execution.
- Consequence never holds or signs; KeeperHub does.
- The payout destination is fixed at ARM time — after resolution it cannot be
  changed, which is the entire point of a precommitment.
- Full history is reconstructable from `.data/ledger.jsonl`.

## Roadmap

- Multi-market bundling (one policy, N conditions, proportional routing).
- AutoRedeemer + exchange-settlement support for new-gen markets.
- KeeperHub schedule-trigger hybrid: resolution observation via `watch` +
  deterministic re-run on missed windows.
- OEV-style socialized gas: one keeper redeems on behalf of many, treasury fee.
- Audits: the added-on-verification angle is that KeeperHub's own workflow
  filter (`forbid raw network egress`, plugin checks) already constrains the
  execution surface.