# Renn — demo video script (3 minutes)

Shot: screen capture, 1920x1080, dark terminal plus the Renn dashboard beside
it. Everything about real transactions stays **EVIDENCE PENDING** until it
lands; the video never pretends a hash exists.

## Evidence gates (must be true before the respective take is real)

| Take | Requires | Marks |
|------|----------|-------|
| 1 (arm + finality) | nothing (already verified live) | reads, states, workflow JSON, WAITING_FINALITY card — all real |
| 2 (KeeperHub lifecycle) | `kh_` org key (present) + ~1 USDC in org wallet `0x9f7d…e6fc` (Polygon) | ~6 sponsored Polygon execution hashes (`pnpm prototype`) |
| 3 (sanity + optional local) | sanity: nothing (recorded `0xd92588…511c6d`); local loop: ~0.6 POL + 2 USDC EOA | 1 recorded Base hash + optional 5 local Polygon hashes |

If a take's prerequisite is missing, say so in the video and stop — no
placeholders dressed as receipts.

## Take 1 — Lock an obligation (0:00–0:50)

```
pnpm arm --market=2252243 --treasury=<beneficiary> --face=1
pnpm status
pnpm watch
# provisional proposal -> card flips to WAITING_FINALITY, SETTLEMENT BLOCKED
```

[The Fed's September 2026 decision — a $48M market. Resolution is proposed and
then disputed, challenged, confirmed. Renn does not settle on a proposal. I
precommit: this condition, this beneficiary, this amount, this exact KeeperHub
workflow — hashed and frozen before the vote. LOCKED OBLIGATION ≠ EDITABLE
AGENT INTENT.]

Browser: `http://localhost:8787`, card in WAITING_FINALITY with the red
**SETTLEMENT BLOCKED** marker, pipeline lit at stage 03. Line on screen:
**Finality gate is the product: no irreversible transaction fires off a
provisional result.**

## Take 2 — The obligation discharged by KeeperHub (0:50–2:00)

[To prove the full loop without waiting on the Fed, Renn creates its own
condition on the real Polymarket CTF contract and lets KeeperHub run the whole
lifecycle from the organisation's wallet — sponsored, no local signing.]

```
pnpm prototype --beneficiary=0x… --face=1
```

On screen, hop by hop, the KeeperHub executions land in `.data/prototype.jsonl`
and the ledger:

1. `approve(USDC → CTF)` — obligation ARMED → LOCKED
2. `prepareCondition` + `splitPosition` — positions held
3. read arm → BUT the pre-resolution read still shows denominator 0:
   **WAITING_FINALITY — SETTLEMENT BLOCKED**
4. `reportPayouts` on-chain → verify `denominator > 0` → RESOLVED
5. `redeemPositions` + `transfer(USDC → beneficiary)` → EXECUTING → SETTLED

[That blank at step 3 is the whole idea: the obligation sat in
WAITING_FINALITY and nothing — nothing — moved on a preliminary number. Only
after the on-chain payout state was final did KeeperHub run the frozen
workflow. Six executions, every one sponsored, every receipt in the ledger,
the obligation discharged.] Dashboard card flips to SETTLED, pipeline to 06,
explorer links live.

## Take 3 — Sponsored execution infra + local cross-check (2:00–2:50)

```
pnpm sanity
# recorded: approve(0) on Base USDC, sponsored, real hash 0xd92588…511c6d
pnpm execute --policy-id=policy-2252243
# simulate the redemption -> success, wouldRevert false; gate blocks while provisional
```

[The executing wallet holds zero native gas — sponsorship is KeeperHub's, the
infrastructure the redemption rides on. And here is the gate refusing to
settle the real FOMC obligation while the payout state is still provisional:
simulate passes, broadcast does not happen. That refusal is the feature.]

Optional take: `pnpm demo:*` reproduces the same mechanism with Renn signing
locally — five real Polygon hashes, the funded cross-check harness (per
`demo:preflight`), not a product requirement.

## Outro (2:50–3:00)

[What is an obligation against an uncertain outcome, worth today? It is
something you can lock before the event and enforce after finality. Renn lets
you commit a payment to an uncertain outcome today; when the world resolves,
KeeperHub settles it — only after the outcome is final. Prediction is
probabilistic; settlement isn't. Repo, docs, and the Arc bounty PR are linked
below.]

## Failure fallbacks

- No USDC in org wallet yet: run Take 1 + Take 3 (sanity recorded; `execute`
  shown refusing while provisional) and mark Take 2 EVIDENCE PENDING on screen.
- No `kh_` key: show `pnpm sanity` failing with the API-key hint, then the
  simulate-then-abort path with redemption calldata only.
- Fed market timing slips: the prototype already captured the whole state
  machine; the Fed arm becomes the "live event mode" narrative.

## Equipment

- Terminal: zsh, dark theme, large mono font.
- Browser: `http://localhost:8787` full screen.
- Recording: screen + mic; terminal left, dashboard right.

## Evidence checklist (final insertion pass)

1. [ ] `approve`, `prepareCondition`, `splitPosition`, `reportPayouts`, `redeemPositions`, routing — from `pnpm prototype` (sponsored, Polygon)
2. [ ] WAITING_FINALITY / SETTLEMENT BLOCKED screenshot (Take 1, transition is real)
3. [x] `sanity` sponsored Base hash — `0xd92588006e3592ad5cffbae53c6478e64f66bf656a024944fd17d836ae511c6d` (approval 0, sponsored)
4. [ ] optional `pnpm demo:*` 5 local Polygon hashes (cross-check harness)
5. [ ] Dashboard screenshots with EVIDENCE PENDING cleared