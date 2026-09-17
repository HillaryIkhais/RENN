# Renn — demo video script (3 minutes, locked sequence)

Shot: screen capture, 1920x1080, dark. The Renn dashboard is the stage; the
terminal is the evidence. Real transactions are real (hashes linked); what has
not happened is labelled PENDING — the video never pretends a hash exists.

The video opens with the **product problem**, not the architecture. Machinery
(cli, gate code, workflow JSON) appears only as proof that the UI is not
theater.

## The locked sequence

```
OPEN        — black screen, the question
RENN        — one sentence: settlement is the authorization condition
POLYMARKET  — EVENT FINAL → OBLIGATION #1 LOCKED → KEEPERHUB EXECUTING
              → ON-CHAIN TRANSFER CONFIRMED → PROVEN SETTLED ✓
              → OBLIGATION #2 UNLOCKED BY PROOF #1 → executes → CHAIN CLOSED
ATTACK      — five attacks, five refusals
EVIDENCE    — the real sponsored hashes + proof object #001
VALUE LEG   — zero-USDC honesty + measured wallet + the one funded command
OUTRO       — "Remove proof of settlement, and the next payment cannot happen."
```

## Evidence gates (must be true before the respective segment is real)

| Segment | Requires | Marks |
|---------|----------|-------|
| OPEN / thesis / chain replay | nothing (dashboard renders the recorded chain) | real two-card unlock animation + proof object #001 |
| Attack mode | nothing (engine's own refusals) | dashboard ATTACK THIS OBLIGATION, all BLOCKED |
| `pnpm proofs` | nothing (verified) | immutability + blocked-execution + exactly-once + chain outputs |
| Real execution | `kh_` org key (present) | six sponsored Polygon hashes + `pnpm verify` PROVEN, chain `CLOSED` |
| Value leg | ~1 USDC in org wallet `0x9f7d…e6fc` | measured on-chain in the dashboard. 0 USDC today → honest PENDING card |

If a segment's prerequisite is missing, say so in the video and stop — no
placeholders dressed as receipts.

## Open — black screen, the question (0:00–0:25)

```
WHAT IF THE NEXT PAYMENT COULD NOT HAPPEN
UNTIL THE LAST ONE WAS PROVEN?
```

Beat. Cut to dark, one line:

> "Who gives the second payment permission to execute?"

```
Payment succeeded.
```

Beat.

> "Did it actually settle?"

RENN, big, on the black:

> **RENN — the next payment only unlocks when the previous settlement is proven.**

Line: **Settlement is not a receipt. It is permission.**

On screen (dashboard, `#unlock` section). Two obligation cards with the lit
connector between them. Say it plainly:

> "A transaction receipt is not enough. A successful execution is not enough.
> Renn independently verifies the actual on-chain settlement **before** allowing
> the dependent obligation to execute."

> "This transaction became possible *because this proof exists.* Not 'here are
> two transactions' — the second payment is authorized by the first settlement's
> proof."

Hit the **proof object #001** panel and read it as an object, not a log:

> "This isn't a status flag. It is an object - a frozen settlement record - that
> obligation #2 references as its unlock condition. **UNLOCKS → OBLIGATION
> #002.**"

## The live example — Polymarket, the real recorded chain (0:25–1:10)

One giant flow (dashboard hero):

```
POLYMARKET EVENT
  ↓  FINAL (on-chain payout state)
OBLIGATION #1   $1 USDC → Beneficiary A   LOCKED
  ↓  KEEPERHUB EXECUTING (redeem + route, sponsored)
ON-CHAIN TRANSFER CONFIRMED
  ↓  RENN re-reads Polygon itself
PROVEN SETTLED ✓
  ↓  proof persists
OBLIGATION #2   UNLOCKED BY PROOF #1
  ↓  executes
CHAIN CLOSED
```

Voice:

> "This is the real, recorded chain: two obligations, one event already final
> on the Polymarket CTF. KeeperHub executes. Renn does not trust the receipt —
> it re-reads the chain, verifies the exact USDC transfer to the exact
> beneficiary, and only then persists the proof. And that proof is what unlocks
> obligation #2."

On the terminal, only the receipts that make the claim immovable:

```
pnpm status    → chain chain-mu59jxk3 CLOSED
pnpm verify    → PROVEN: FINALITY + INTEGRITY + EXECUTION + exact TRANSFER
```

## Attack it — the engine refuses (1:10–2:00)

`#attack` section: **ATTACK THIS OBLIGATION.** Click each attack. The red
`BLOCKED` is the engine's own refusal — same `gates.ts` / `chain.ts` /
`proof.ts` / `verify.ts` the execute path runs. No mock, no second source of truth.

1. **CHANGE BENEFICIARY** → `BLOCKED — ENVELOPE MISMATCH`
2. **CHANGE AMOUNT** → `BLOCKED — ENVELOPE MISMATCH`
3. **DELETE SETTLEMENT PROOF** → `BLOCKED — PREDECESSOR NOT PROVEN`
4. **EXECUTE OBLIGATION #2 EARLY** → `BLOCKED — DEPENDENCY NOT SETTLED`
5. **CLAIM PAYMENT #1 SUCCEEDED** → `BLOCKED — NO VERIFIED TRANSFER`

Under the last one, hold the shot and say the two distinctions the product
runs on:

> "Execution is not settlement." — a confirmed transaction is just a broadcast.
> "And settlement is not proven settlement." — Renn re-verifies on chain what
> actually moved, to whom, at exactly what amount.

Pause the demo; show `pnpm proofs` in the terminal (gate guarantees in code,
same modules the product uses — immutability, finality gate, exactly-once,
chain gate). Line:

> "The dashboard is a UI. The guarantee lives in code — and we just attacked it
> with the product's own gate functions. Every one held."

## The real chain — six sponsored Polygon transactions (2:00–2:35)

`#proof` section — LIVE MAINNET EXECUTION PROOF. List the real recorded
KeeperHub executions (all `sponsored:true`, all PolygonScan-backed):

- #1 `policy-acb077c5` PROVEN_SETTLED — approve `0xf70b1f79…`, redeem `0x65005ee0…` (`dmr1g67…`), route `0x21a05f32…` (`kcdpl20…`)
- #2 `policy-3f07ac4b` PROVEN_SETTLED — approve `0x29e3824c…`, redeem `0x6588bfc4…` (`kgnq0yep…`), route `0xb76fbaa7…` (`a56nmmxi…`)

Voice:

> "Two obligations, one chain, and obligation #2 executed only because #1 was
> independently proven settled on chain — the unlock condition is the persisted
> proof, not a status flag. This is a settlement proof that became executable
> state."

## The value leg — honest, measured, pending (2:35–2:55)

Dashboard card reads **ZERO ASSET VALUE / NONZERO PENDING**, now backed by the
**measured** org-wallet balance (read on Polygon at demo time, shown on screen):

> "Every transaction above is real and gas-sponsored, but settles zero USDC —
> the wallet measured **0 USDC** on-chain today. We do not claim a value leg we
> have not run. Everything above exists now; the value leg closes with one
> command the moment the org wallet holds ~1 USDC:"

```
pnpm chain --resolved=<finalized A> --chain-resolution=<finalized B> --beneficiary=0x0716… --face=1
```

> "That same chained path then moves face value — 1 USDC → verified transfer →
> proof persisted → obligation #2 unlocks → second real settlement → chain
> closed. Until then: mechanism proven, value leg PENDING — not faked."

## Outro (2:55–3:05)

Black screen, one line:

> **Remove proof of settlement, and the next payment cannot happen.**

That is the product. Repo and docs linked; `README.md` has the full
architecture and the exact evidence list.

## Failure fallbacks

- No USDC in org wallet yet (current state): film everything except the value
  leg; the measured-0-USDC card is itself the outro beat.
- No `kh_` key: show `pnpm proofs` (no network), the two-card chain replay, and
  attack mode live; present the recorded six hashes from the ledger without
  pretending they happened live.
- Dashboard evidence strip empty: failure of the integration is shown, not
  hidden, then cut.

## Equipment

- Terminal: zsh, dark theme, large mono font.
- Browser: `http://localhost:8787` full screen.
- Recording: screen + mic; terminal left, dashboard right.

## Evidence checklist (final insertion pass)

1. [x] Dashboard hero flow — EVENT FINAL → OBLIGATION LOCKED → KEEPERHUB → VERIFIED → PROVEN → NEXT UNLOCKED
2. [x] Two-card proof→unlock chain replay + **proof object #001** panel
3. [x] Attack mode: CHANGE BENEFICIARY / CHANGE AMOUNT / DELETE SETTLEMENT PROOF / EXECUTE #2 EARLY / CLAIM PAYMENT #1 SUCCEEDED — all BLOCKED by the engine
4. [x] Six sponsored Polygon hashes (chain `chain-mu59jxk3` CLOSED) + `pnpm verify` PROVEN
5. [x] `pnpm proofs` outputs (immutability + blocked + exactly-once + chain) — scratch-ledger run
6. [ ] Screenshot the dashboard with the measured on-chain wallet line (0 USDC → VALUE LEG PENDING COLLATERAL)
7. [ ] Once funded: ONE more Polygon run with real USDC + receipt (completes the value leg)