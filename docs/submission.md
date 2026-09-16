# Renn — DoraHacks Main Track Submission Packet

**Project name:** Renn
**One-line pitch:** Prediction is probabilistic. Settlement isn't.
**Category:** Agent Economy — deterministic, on-chain-triggered financial execution
**Deadline:** September 18 12:00 CEST / 11:00 WAT
**Repo:** `keeperhub-polymarket` (package `renn`)

---

## Problem

Prediction markets are unmatched at pricing an uncertain event. They are
equally unmatched at *doing something after it resolves*. When Polymarket
resolves a condition it does not sweep winning shares into a wallet: winning
positions must be redeemed on-chain (via the CTF, the NegRisk adapter, or
exchange settlement) and only then does the collateral become spendable USDC.
None of that happens by itself, and none of it happens synchronously.

The practical result is a silent capital-loss machine:

1. **Collection is broken by default.** Resolved-but-unredeemed positions are
   common; every one is a payout someone forgot to collect.
2. **Timing is everything, humans are bad at it.** Redemption is mechanical,
   time-sensitive, and lands exactly in the window when a winner is least
   likely to be watching.
3. **Money routing is where policy lives.** "Take the payout, send it to X" is
   the actual decision. It should be made once, in advance, auditable — and
   then never re-litigated.

## Solution

Renn is a precommitted execution layer between Polymarket resolution and
KeeperHub execution. An operator arms a *policy* before resolution: the market,
the position, and the payout destination are all fixed in advance. On
resolution day, Renn's state machine advances only on on-chain evidence
(`payoutDenominator(conditionId) > 0` on the Conditional Tokens contract) and
hands the one, fixed, inspectable workflow to KeeperHub to redeem and route.

`ARMED → LOCKED → RESOLVED → EXECUTING → SETTLED`

The guarantee is the product: the recipient of the payout can audit the whole
pipeline before a single share is bought.

## Why KeeperHub

Renn deliberately refuses to sign transactions. The stage that actually moves
money is an ordinary KeeperHub workflow:

1. `web3/read-contract` — `payoutDenominator(conditionId)` on
   `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`.
2. `Condition` gate — proceed only if the payload is non-zero (the gating
   expression is visible in the workflow JSON).
3. `web3/write-contract` — the `redeemPositions` redemption path.
4. `web3/transfer-token` — route the winning USDC to the precommitted treasury.

This is what repurposing "agents" correctly looks like: the agent does not
decide, it executes. The policy was the decision; the workflow is the trust
boundary; the ledger is the audit. Custody, simulation, gas sponsorship,
idempotency, and receipt reconciliation all come from KeeperHub. Renn
contributes the resolution trigger, the redemption math, and the precommitment
contract around it.

## Architecture

```
                  POLYMARKET                        KEEPERHUB
  Gamma API ──> conditionId ──> on-chain CTF   ──> workflow (read/gate/redeem/route)
       │                │                             │            │
       │                ▼                             ▼            ▼
   market truth     payoutDenominator > 0    simulate -> broadcast   status poll
       │                │                    (success && !revert)   (completed)
       └────────────────┴───────────── RENN policy ledger (append-only JSONL)
```

| Layer | Component | Location |
|-------|-----------|----------|
| Market truth | Gamma API client + on-chain resolution detector | `src/polymarket/` |
| Redemption | CTF / NegRiskAdapter redemption, ABI-verified against live CTF | `src/polymarket/redemption.ts` |
| Execution | KeeperHub workflow composer + safe direct-execution client | `src/keeperhub/` |
| Policy | Append-only state machine (ARMED to SETTLED) | `src/policy/` |
| Surface | CLI (`arm`, `status`, `watch`, `execute`, `demo:*`, `sanity`) + live console | `src/index.ts`, `dashboard/` |
| Demo | Deterministic, real-mainnet CTF condition under Renn's control | `src/polymarket/demo-engine.ts` |

## Exact live-demo sequence

The deterministic demo runs on the *real* Polymarket Conditional Tokens
contract, with a condition Renn creates and resolves on demand. Five real
Polygon mainnet transactions:

| Step | Command | On-chain action | Policy state |
|------|---------|-----------------|--------------|
| 0 | `pnpm demo:preflight` | reads live gas price, prints exact funding | — |
| 1 | `pnpm demo:bootstrap` | `prepareCondition` (creates condition), `splitPosition` (25→1 USDC into YES+NO) | ARMED → LOCKED |
| 2 | `pnpm demo:resolve` | `reportPayouts` (sets on-chain winner) | RESOLVED |
| 3 | `pnpm demo:distribute` | `redeemPositions` on CTF, USDC `transfer` to treasury | EXECUTING → SETTLED |
| 4 | `pnpm dashboard` | live console shows the states and any real hashes | — |

The live-market variant arms the real September 2026 FOMC market (2252243),
and KeeperHub drives the redemption through the simulate → broadcast →
status-poll loop in `src/keeperhub/client.ts`.

## What is live vs what requires funded execution

**Verified live already (no funding, no credentials):**
- All four Polymarket contracts confirmed present on Polygon mainnet.
- CTF ABI / function selectors / position-ID math validated against the live
  CTF via read calls.
- Resolution detection: `payoutDenominator == 1` on already-resolved markets,
  `0` on the pending FOMC market.
- Policy ledger state machine and workflow-envelope composition via
  `pnpm arm` / `pnpm status`.
- The dashboard and CLI end-to-end.

**Requires sub-$1 funding (our funded local proof harness — NOT the product):**
- The deterministic demo loop's real transaction hashes
  (~0.06-0.23 POL + 1 USDC principal; exact figure from `demo:preflight`).
  These are the self-created-CTF evidence hashes.

**Requires a free KeeperHub organisation key (`kh_…`):**
- The zero-value sponsored execution proof (`pnpm sanity`: a real mainnet
  `approve(0)` on Base USDC from an empty org wallet).
- The KeeperHub-driven redemption run (`pnpm execute`).

The product itself is the KeeperHub execution layer and does not require the
local POL/USDC harness at all; zero-value writes and reads run unfunded.

## Repo setup

```bash
pnpm install
cp .env.example .env          # add KEEPERHUB_API_KEY (free, kh_ org key)
pnpm typecheck                # green
pnpm demo:preflight           # prints exact funding
pnpm status                   # starts empty
pnpm dashboard                # live console: http://localhost:8787
```

No server, no bot network, no cloud dependency.

## Demo video script

See `docs/demo-script.md` (3-minute capture script). Footer of the dashboard
and every evidence block is marked **EVIDENCE PENDING** until real hashes are
inserted. No fake receipts, no fake live execution.

## Transaction / evidence placeholders

| Evidence | Where it lands | Status |
|----------|----------------|--------|
| `prepareCondition` tx | `pnpm demo:bootstrap` | PENDING (funded harness) |
| `splitPosition` tx | `pnpm demo:bootstrap` | PENDING |
| `reportPayouts` tx | `pnpm demo:resolve` | PENDING |
| `redeemPositions` tx | `pnpm demo:distribute` | PENDING |
| USDC routing tx | `pnpm demo:distribute` | PENDING |
| `sanity` sponsored tx (Base) | `pnpm sanity` | PENDING (kh key) |
| KeeperHub redemption execution | `pnpm execute --policy-id=…` | PENDING (kh key) |
| On-chain resolution + ABI verification | README "Evidence status" | DONE |

Hashes are appended automatically to `pnpm status` output and the dashboard
when each step runs; nothing requires hand-editing.

## Security and trust

- Money only moves on an on-chain predicate; a closed-but-unresolved market
  never triggers execution.
- Every broadcast is preflighted live (simulate, `success` + `wouldRevert:false`)
  before it is signed.
- Renn never holds or signs; KeeperHub does.
- The payout destination is fixed at ARM time — after resolution it cannot be
  changed, which is the entire point of a precommitment.
- Full history is reconstructable from `.data/ledger.jsonl`.

## Roadmap

- Multi-market bundling (one policy, N conditions, proportional routing).
- AutoRedeemer + exchange-settlement support for new-gen markets.
- KeeperHub schedule-trigger hybrid: resolution observation via `watch` plus
  deterministic re-run on missed windows.
- Shared keepers: one wallet redeems on behalf of many, treasury fee.
- Audits: KeeperHub's own workflow filters (forbid bare egress, plugin checks)
  already constrain the execution surface.