# Renn — demo video script (3 minutes)

Shot: screen capture, 1920x1080, dark terminal plus the Renn dashboard beside
it. Everything about real transactions stays **EVIDENCE PENDING** until the
funded harness and the `kh_` key are in place; the video never pretends a hash
exists.

## Evidence gates (must be true before the respective take is real)

| Take | Requires | Marks |
|------|----------|-------|
| 1 (arm + dashboard) | nothing (already verified live) | reads, states, workflow JSON — all real |
| 2 (deterministic loop) | ~0.6 POL + 2 USDC in the throwaway EOA | 5 real Polygon hashes |
| 3 (KeeperHub execution) | free `kh_` org key | 1 sponsored Base hash + simulate log |

If a take's prerequisite is missing, say so in the video and stop — no
placeholders dressed as receipts.

## Take 1 — Arm (0:00–0:50)

```
pnpm market:find --resolving-next 7
# streams the FOMC market: 2252243, ~$48M volume, resolves 2026-09-16
pnpm arm --market=2252243 --treasury=<treasury> --amount=1
pnpm status
```

[This is Renn: prediction is probabilistic, settlement isn't. The market at
the center is the Fed's September 2026 rate decision. Forty-eight million
dollars of volume. It resolves tomorrow. We declare a policy: this market, and
this payout destination — locked in stone right now, before the vote. No one
can reroute it later.]

Browser: `http://localhost:8787`, card in state ARMED, pipeline lit at stage 01.
Line on screen: **On-chain truth read: payoutDenominator = 0. EVIDENCE PENDING
for hashes.**

## Take 2 — The deterministic demo loop (0:50–1:50)

[To show the loop's spine without waiting on the Fed, Renn creates its own
condition on the real Polymarket Conditional Tokens contract — the same
contract Polymarket runs on.]

```
pnpm demo:preflight
# prints live fees + the exact sub-$1 budget for the whole loop
pnpm demo:bootstrap
# prepareCondition -> split 1 USDC into YES/NO on-chain
pnpm status
# ARMED -> LOCKED
pnpm demo:resolve
# reportPayouts on-chain -> payoutDenominator(conditionId) > 0
pnpm status
# LOCKED -> RESOLVED
pnpm demo:distribute
# redeemPositions on CTF -> USDC transfer to treasury
pnpm status
# EXECUTING -> SETTLED, hashes on screen
```

[The only thing that moved the policy was the on-chain payout denominator — no
human instruction. The wallet provably holds the winning position, the winner
is reported on-chain, the shares are redeemed, and the USDC arrives at the
precommitted address. The ledger holds every hash.] Dashboard flips the card
to SETTLED, pipeline to 05, explorer links live.

## Take 3 — KeeperHub as the executor (1:50–2:50)

```
pnpm sanity
# simulate approve(0) on Base USDC -> success, wouldRevert false
# broadcast under fresh Idempotency-Key -> sponsored, real hash, empty wallet
```

[Key point: the executing wallet held zero native gas. KeeperHub's sponsored
gas covered the fee. This is the execution layer itself — a real mainnet
transaction from an empty wallet, because the write moves nothing. That is the
infrastructure Renn's redemption run rides on.]

```
pnpm execute --policy-id=policy-2252243
# simulate the redemption -> success, wouldRevert false
# broadcast -> status poll -> completed -> SETTLED
```

[On resolution KeeperHub fires: it reads the on-chain predicate; if the
market hasn't resolved, the gate blocks — no money moves on a coin-flip. When
the Fed's answer lands, the workflow redeems and routes. One run, no human in
the loop, full receipt trail.] Stream the KeeperHub simulation + execution log.

## Outro (2:50–3:00)

[Prediction markets are the best pricing machine we have. Renn is the
settlement layer they were missing: prediction is probabilistic, settlement
isn't. Repo, docs, and the Arc bounty PR are linked below.]

## Failure fallbacks

- No funding yet: skip Take 2's live hashes, narrate Take 1 + Take 3 (zero
  value, sponsored) and mark Take 2 EVIDENCE PENDING on screen.
- No `kh_` key yet: show `pnpm sanity` failing with the API-key hint, then
  demonstrate the simulate-then-abort path with the redemption calldata only.
- Fed market timing slips: the deterministic loop already captured the whole
  state machine; the Fed arm becomes the "live event mode" narrative.

## Equipment

- Terminal: zsh, dark theme, large mono font.
- Browser: `http://localhost:8787` full screen.
- Recording: screen + mic; terminal left, dashboard right.

## Evidence checklist (final insertion pass)

1. [ ] `prepareCondition` / `splitPosition` hashes from `demo:bootstrap`
2. [ ] `reportPayouts` hash from `demo:resolve`
3. [ ] `redeemPositions` + routing hashes from `demo:distribute`
4. [ ] `sanity` sponsored Base hash
5. [ ] KeeperHub `execute` executionId + transaction link
6. [ ] Dashboard screenshots with EVIDENCE PENDING cleared