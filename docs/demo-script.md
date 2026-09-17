# Renn — demo video script (3 minutes)

Shot: screen capture, 1920x1080, dark terminal plus the Renn dashboard beside
it. Real transactions are real (hashes linked); what has not happened is
labelled PENDING — the video never pretends a hash exists.

## Evidence gates (must be true before the respective segment is real)

| Segment | Requires | Marks |
|---------|----------|-------|
| 1 (arm / finality / block) | nothing (verified live) | real states, reads, workflow JSON, WAITING_FINALITY / SETTLEMENT BLOCKED cards |
| 2 (failure proofs) | nothing (verified) | `pnpm proofs` — immutability + blocked-execution + exactly-once + chain outputs |
| 3 (KeeperHub execution + verify) | `kh_` org key (present) | three real sponsored Polygon hashes + `pnpm verify` PROVEN |
| 4 (obligation chain) | `kh_` org key (present) | `pnpm chain` — six sponsored Polygon hashes, chain `CLOSED`, #2 unlocked by #1 PROVEN_SETTLED |
| 5 (live value settlement) | ~1 USDC in org wallet `0x9f7d…e6fc` | NOT YET — shown as an honest pending card |

If a segment's prerequisite is missing, say so in the video and stop — no
placeholders dressed as receipts.

## Take 1 — Lock the obligation and show the gate (0:00–0:50)

```
pnpm arm --market=2252243 --treasury=<beneficiary> --face=1
pnpm status
```

[The Fed's September 2026 decision — a $48M market, now finally resolved on
chain (denominator 1, YES wins). Renn does not settle on a proposal. I
precommit: this condition, this beneficiary, this amount, this exact KeeperHub
workflow — hashed and frozen before anything fires. LOCKED OBLIGATION ≠
EDITABLE AGENT INTENT.]

On screen: the policy shows the on-chain read `YES wins (denom 1)`. To show
the gate, rewind to the provisional story: a freshly armed obligation whose
condition has no final payout state reads as **WAITING_FINALITY / SETTLEMENT
BLOCKED** on the dashboard — stage 03, red marker. Line on screen: **Finality
gate is the product: no irreversible transaction fires off a provisional
result.**

## Take 2 — Prove the gate with code, not screenshots (0:50–1:20)

```
pnpm proofs
```

[The dashboard is a UI; the guarantee lives in code. Four proofs, run live
from the same modules the product uses:]

1. **Obligation immutability** — tampering beneficiary, face value, or
   condition after locking produces a different envelope hash, so the execute
   path throws `LOCKED OBLIGATION MISMATCH`. Nothing can be quietly changed
   after the freeze.
2. **Finality gate** — a policy in WAITING_FINALITY is refused by the execute
   path: `SETTLEMENT BLOCKED … No irreversible obligation fires on a
   preliminary result`.
3. **Exactly-once** — a settled obligation refuses a duplicate payment:
   `ALREADY SETTLED`. Settlement consumes the execution authority; a failed
   execution stays alive under the same frozen hash and can only discharge the
   obligation, never mint a new payout.
4. **Obligation chain** — a chained obligation whose predecessor is only
   `LOCKED` is refused: `OBLIGATION CHAIN BLOCKED`. Re-pointing the predecessor
   changes the frozen envelope hash. Settlement proof is executable state, and
   the unlock condition cannot be edited after locking.

Run from a scratch ledger (`.data/proofs/`), zero funding, real code paths.

## Take 3 — KeeperHub discharged a real obligation, and Renn proved it (1:20–2:20)

[To prove the loop against the actual Polymarket CTF contract without waiting
on a vote, Renn armed a finally-resolved condition and let KeeperHub run the
whole lifecycle from the organisation's wallet — sponsored, no local signing.]

```
pnpm zero-value --resolved=0x0c481aa6…4e4eae0 --parent=0x0000…0000 --beneficiary=0x0716…
pnpm verify --policy-id=policy-ca2df166
```

Dashboard: the **LIVE MAINNET EXECUTION PROOF — ZERO ASSET VALUE** strip lists
the real sponsored executions (`.data/zero-value.jsonl`, all PolygonScan
verified):

1. `approve(CTF, 0)` — executionId `dblyr1n2ahek4iegwi96b`, tx `0x1579c791…64a`
2. `redeemPositions` on the real condition — executionId `a9o7uh3k9mth5mhnmeoay`, tx `0xc7953f32…ff77`
3. routing value to beneficiary — executionId `y3729jn0stn1xmdmafg6h`, tx `0x2c453a77…45f1`

[That redeemPositions call is not a mock — it exercised the real Polymarket
CTF contract at `0x4D97…6045`. But the important part is the next command:
`pnpm verify` does not trust "the tx exists" or "KeeperHub said completed". It
re-reads Polygon itself: finality (denom 1 on chain), envelope integrity,
confirmed transaction, beneficiary possession. **OBLIGATION PROVEN SETTLED.**]

## Take 4 — The obligation chain: a proven settlement becomes the next authorization (2:20–2:50)

[The strongest artifact: a settlement proof that is executable state. Two
obligations, one chain. Obligation #2 is frozen *in advance* with a dependency
on #1 — so it can only fire once #1's settlement is independently PROVEN.]

```
pnpm chain --resolved=0x0c481aa6…4e4eae0 --chain-resolution=0x3733a1b6…b3868 --beneficiary=0x0716…
pnpm status
```

[Watch the line `[chain] OBLIGATION UNLOCKED by policy-acb077c5 (PROVEN_SETTLED)`
— gate 1.5 re-verifies #1 on chain before #2 is allowed to execute. Six
sponsored Polygon mainnet transactions, empty org wallet:]

- #1 `policy-acb077c5` PROVEN_SETTLED — approve `0xf70b1f79…`, redeem `0x65005ee0…` (`dmr1g67zmpejb6f94i8hp`), route `0x21a05f32…` (`kcdpl20ya8ddd315z35jo`)
- #2 `policy-3f07ac4b` PROVEN_SETTLED — approve `0x29e3824c…`, redeem `0x6588bfc4…` (`kgnq0yepac4wiksc6wcf2`), route `0xb76fbaa7…` (`a56nmmxi3ib9hzgydfwgk`)

`pnpm status` and the dashboard chain card read **CHAIN CLOSED —
chain-mu59jxk3**. This is the difference between a good integration and a
system: the first settlement's proof is the second obligation's authorization.

## Take 5 — The live value leg (2:50–3:10)

[Nothing in the demo so far moved real value — every leg settled zero USDC.
Funding the executing wallet with value is the last leg, and it is honest and
open:] screen card reads **NONZERO SETTLEMENT — PENDING COLLATERAL: pending ~1
USDC collateral** — the exact, smallest sponsored/demo allocation requested
from KeeperHub. The mechanism, the chain, the hashes, and the dashboard all
exist now; the value leg lands when the wallet holds the asset.

## Outro (3:10–3:20)

[What is an obligation against an uncertain outcome, worth today? It is
something you can lock before the event and enforce after finality. Prediction
is probabilistic; settlement isn't. Repo and docs are linked below.]

## Failure fallbacks

- No USDC in org wallet yet (the current state): film Takes 1–2 fully, Take 3
  from the real on-chain hashes, and end on the pending-value card (Take 4 as
  the honest status).
- No `kh_` key: show `pnpm proofs` (no network) then the simulate-then-abort
  path with redemption calldata only.
- Dashboard evidence strip empty: failure of the integration is shown, not
  hidden, then cut.

## Equipment

- Terminal: zsh, dark theme, large mono font.
- Browser: `http://localhost:8787` full screen.
- Recording: screen + mic; terminal left, dashboard right.

## Evidence checklist (final insertion pass)

1. [x] Three real sponsored Polygon hashes from the Layer-1 proof
2. [x] `pnpm proofs` outputs (immutability + blocked + exactly-once + chain) — scratch-ledger run
3. [x] `pnpm verify` output (PROVEN: finality + integrity + execution + postcondition)
4. [x] `sanity` sponsored Base hash — `0xd92588006e35…511c6d` (approve 0, sponsored)
5. [x] `pnpm chain` output — chain `chain-mu59jxk3` CLOSED, six sponsored Polygon hashes, #2 unlocked by #1 PROVEN_SETTLED
6. [ ] Dashboard screenshots with the LIVE MAINNET EXECUTION PROOF — ZERO ASSET VALUE strip + OBLIGATION CHAIN — CHAIN CLOSED + NONZERO SETTLEMENT — PENDING COLLATERAL card
7. [ ] Once funded: ONE more Polygon run with real USDC + receipt (completes Take 5)