# Demo script — 3 minutes flat

Shot: screen capture, 1920x1080, dark terminal + the Consequence dashboard in a
browser beside it. Narration in brackets.

Buffer: the demo wallet has POL for gas and ~30 USDC. Commands below reference
that wallet via a local `.env`.

## Take 1 — Arm (0:00–0:50)

```
pnpm market:find --resolving-next 7
# terminal streams the FOMC market: 2252243, $48M volume, resolves 2026-09-16
```

[The market at the center of this demo is the Fed's September 2026 rate decision.
48 million dollars of volume. It resolves tomorrow.]

```
pnpm arm --market=2252243 --treasury=<treasury> --amount=25
pnpm status
```

[We declare a policy: this market, this position size, and this — the payout
destination — which is locked in stone right now, before the vote. No one can
reroute it later.]

Browser: open `http://localhost:8787`. Dashboard shows the card in state ARMED,
the pipeline lit at stage 01.

## Take 2 — The deterministic demo loop (0:50–1:50)

[The FOMC market resolves tomorrow. To show the loop twice — once on a market I
control the timing of, once on the real event — the demo engine creates its own
condition on the *real* Polymarket Conditional Tokens contract.]

```
pnpm demo:bootstrap
# -> prepareCondition, split: 25 USDC -> 2 x 25 CTF positions (YES/NO)
pnpm status
```

[The policy is now LOCKED: the wallet provably holds 25 units of the winning
position on-chain.]

```
pnpm demo:resolve
# -> reportPayouts on-chain -> payoutDenominator(conditionId) > 0
pnpm status
```

Karl-zoom on status: state RESOLVED. [The only thing that moved the policy was
the on-chain payout denominator. No human instruction.]

```
pnpm demo:distribute
# -> redeemPositions on CTF -> transfer USDC to treasury
pnpm status
```

[EXECUTED, SETTLED. The USDC arrived at the precommitted address, and the ledger
holds every hash. This shutdown — arm, hold, resolve, execute, settle — is the
whole product, played out on real Polygon transactions.]

Dashboard: card flips to SETTLED, pipeline lights to 05, explorer links live.

## Take 3 — The real market with KeeperHub as the executor (1:50–2:50)

```
pnpm arm --market=2252243 --amount=25 --schedule
.dta/workflows/policy-2252243.json
```

[This is the workflow KeeperHub will run: a read of payoutDenominator, a gate,
a redemption through the same contract Polymarket uses, and a transfer to our
treasury. The JSON is the artifact I hand to KeeperHub — composed, staged,
inspectable.]

```
pnpm execute --policy-id=policy-2252243
```

[On resolution KeeperHub fires. It reads the on-chain predicate; if the market
hasn't resolved, the gate blocks — no money moves on a coin-flip. When the Fed's
answer lands, the workflow redeems and routes. One auction, no human in the
loop, full receipt trail.]

Console: KeeperHub execution log streams — read-contract, gate, redeem tx,
transfer tx, receipts.

## Outro (2:50–3:00)

[Prediction markets are the best pricing machine we have. Consequence is the
execution layer they were missing: your prediction can be uncertain, your
financial response cannot. Repo, docs, and the Arc bounty PR are linked below.]

## Failure fallbacks

- If the Fed market already resolved or funding is short: rely entirely on
  `pnpm demo:resolve` for the LIVE-trigger shot and narrate the real market as
  the production variant.
- If KeeperHub org credentials aren't ready: show the workflow JSON + execute
  dry-run, and swap the executor narration to "staged for KeeperHub".
- Dashboard off-screen: use `pnpm status` as the primary visual; it prints rich
  per-policy state.

## Equipment

- Terminal: zsh, dark theme, large mono font.
- Browser: `http://localhost:8787` full screen.
- Recording: screen + mic; capture window is terminal left, dashboard right.