# Consequence

**Polymarket resolution, executed by KeeperHub.**

> Your prediction can be uncertain. Your financial response cannot.

Consequence is a self-executing bridge between Polymarket's prediction markets
and KeeperHub's deterministic workflow engine. You precommit, in advance, what
the money does when the market resolves. The day the world decides, Consequence
does not consult anyone: it verifies the on-chain resolution, redeems the
winning shares, and routes the payout to the destination you locked in — every
step executed by KeeperHub, every step recorded in an append-only ledger with
verifiable transaction receipts.

Part of the KeeperHub "Agent Economy" Hackathon (main track) and the Arc
Testnet chain-registration bounty (issue #2230, merged in the accompanying PR).

## Why this matters

Prediction markets have an asymmetry. Half the battle — pricing, hedging,
sizing — happens *before* resolution. The other half — actually collecting the
payout and acting on it — happens *after*, and it is exactly where humans
hesitate, delay, or forget. A resolved market that never gets redeemed is a
silent capital-loss machine:

- Winning shares sit in wallets, unredeemed, worth real USDC.
- Refund decisions and treasury rebalancing wait on an individual.
- "Do the thing on resolution" is precisely what a deterministic keeper should do.

Consequence collapses the after-the-fact half of the trade into a precommitted,
autonomous pipeline. The value it unlocks is the *guarantee*: a consequence
pipeline can be audited by the recipient before a single share is bought.

## The loop

```
1. ARM     — declare a policy: market, position, payout destination.
2. LOCK    — the executing wallet provably holds the winning CTF positions.
3. RESOLVE — on-chain truth: CTF payoutDenominator(conditionId) > 0.
4. EXECUTE — KeeperHub runs the workflow: redeem + route (deterministic).
5. SETTLED — USDC arrives at the destination; every tx is in the ledger.
```

Each stage is a tracked state in `src/policy/ledger.ts`. Transitions are only
ever driven by on-chain evidence, never by a human "please pay" instruction.
`payoutDenominator` on the Polymarket Conditional Tokens contract is the only
thing that moves a policy from RESOLVED to EXECUTING.

## Why KeeperHub

The execution is KeeperHub's job, not ours. Consequence composes a real
KeeperHub workflow — with `web3/read-contract`, a gate, `web3/write-contract`
and `web3/transfer-token` nodes — and hands it to KeeperHub to run:

| KeeperHub step            | Role                                                  |
|---------------------------|-------------------------------------------------------|
| `web3/read-contract`      | read `payoutDenominator(conditionId)` on the CTF      |
| `Condition` gate          | continue only when the market is resolved             |
| `web3/write-contract`     | `redeemPositions` on the CTF redemption path          |
| `web3/transfer-token`     | route the winning USDC to the precommitted treasury   |

The workflow is emitted as a plain JSON envelope (`src/keeperhub/workflow.ts`)
that can be imported into the KeeperHub builder, driven over the MCP/API
surface, or executed directly. Because KeeperHub executes from the
organization's wallet with a full audit log (every tx hash, every receipt
status, every step output), Consequence gets custody-grade execution without
running money logic natively.

## Redemption paths

- **Classic CTF redemption** — `redeemPositions(collateral, parent, condition,
  [1, 2])` on the Polymarket Conditional Tokens contract
  (`0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`). No approval required.
- **NegRisk redemption** — `redeemPositions(conditionId, [yes, no])` on the
  NegRisk adapter (`0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`), gated by a
  one-time `setApprovalForAll` step that the workflow includes automatically.
- **AutoRedeemer / exchange settlement** — for new-generational CLOB markets,
  resolution settlement is observed and the routing step still applies.

All redemption paths run on Polygon mainnet (chain 137), the chain Polymarket
uses. USDC collateral: `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359`.

## Deterministic demo mode

The fastest way to see the whole loop is the deterministic demo, which uses the
*real* Polymarket CTF contract with a condition Consequence itself creates:

```bash
pnpm demo:preflight     # exact minimum POL + USDC before you fund anything
pnpm demo:bootstrap     # prepare a CTF condition, split USDC into YES shares, arm a policy
pnpm demo:resolve       # report the payout on-chain -> policy moves to RESOLVED
pnpm demo:distribute    # redeem winning shares + route USDC to the treasury -> SETTLED
pnpm status             # the ledger: states, tx hashes, per-policy resolution
pnpm dashboard          # live console at http://localhost:8787
```

Every transaction in the demo is a real Polygon mainnet transaction on the
contract Polymarket uses. No test doubles, no mocks. Designed to be cheap on
purpose: on a live test the whole five-transaction loop ran inside a budget of
about 0.06-0.23 POL plus 1 USDC of principal — run `pnpm demo:preflight` and
it prints your exact, live-fee figure before you move any money. Keep only
that tiny balance in the demo wallet.

## Live event mode

```bash
pnpm market:find                      # list markets resolving in the next 7 days
pnpm arm --market=<id> --treasury=<addr> [--amount=<usdc>]
pnpm watch                            # poll on-chain resolution until it fires
pnpm execute --policy-id=<policy-id>  # simulate, then hand the write to KeeperHub
pnpm sanity                           # zero-value sponsored execution proof (empty wallet, real tx)
```

`execute` follows the safe loop KeeperHub documents: dry-run the redemption
against the live chain (`simulate: true`), abort unless the simulation reports
`success: true` and `wouldRevert: false`, then broadcast under a fresh
`Idempotency-Key` and poll the execution to a terminal status. `sanity` lands a
real `approve(spender, 0)` on USDC (Base mainnet) from an organisation wallet
with a zero native balance — sponsored gas covers the fee and no tokens move.

Featured market: the September 2026 FOMC rate decision (market 2252243,
"Will the Fed decrease interest rates by 25 bps…", ~$48M volume) — resolves
September 16, 2026, inside the hackathon window.

## Environment

| Variable | Purpose |
|----------|---------|
| `EOA_PRIVATE_KEY` | wallet that owns the positions (demo + mainnet loop) |
| `EOA_ADDRESS` | its address (used by `demo:preflight` balance reads) |
| `TREASURY_ADDRESS` | the enforced payout destination |
| `KEEPERHUB_API_KEY` | org API key (`kh_…`) for simulation + sponsored execution |
| `KEEPERHUB_API_BASE` | default `https://app.keeperhub.com` |
| `MARKET_ID` | default market for `pnpm arm` |
| `POSITION_VALUE_USDC` | position size used in staged workflows |
| `DEMO_AMOUNT_USDC` / `DEMO_WINNER` | deterministic demo parameters (default 1 USDC) |

## Security model

- **On-chain gating.** Nothing executes "because the market closed". Execution
  only proceeds when `payoutDenominator` is non-zero on Polygon.
- **Append-only ledger.** Every state change and transaction is appended to a
  replayable JSONL ledger (`src/policy/ledger.ts`); the whole history is
  reconstructable from the file.
- **Receipt-backed.** Each execution step records its tx hash and explorer link;
  the dashboard and CLI surface them for independent verification.
- **No secret handling in Consequence.** Consequence never signs; KeeperHub's
  wallet infrastructure does.
- **Precommitment is the control.** The destination address is fixed at ARM
  time. The payout cannot be rerouted after resolution.

## What was verified on-chain

- The four core Polymarket contracts exist on Polygon (`eth_getCode`).
- The CTF ABI / function selectors are valid against the live CTF
  (`getCollectionId`, `getPositionId`, `payoutDenominator` via `eth_call`).
- Resolution detection: `payoutDenominator == 1` on already-resolved markets,
  `0` on the pending FOMC market.
- Workflow envelope composition and the ledger state machine are exercised by
  `pnpm arm`, `pnpm status`, and the dashboard.