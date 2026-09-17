# Renn — demo video script (serial-winner flow, ~3 minutes)

Shot: screen capture, 1920x1080, dark. The Renn dashboard is the stage; the
terminal is the evidence. Real transactions are real (hashes linked); what has
not happened is labelled PENDING — the video never pretends a hash exists.

The structure is the CLASP serial winner: **exact host failure → narrow
primitive → external truth → hard boundary → adversarial proof → real
sponsored execution → closed loop → memorable primitive.** Not a feature tour,
not "here are nine attacks," not architecture first.

## The locked sequence

```
1. HOST FAILURE    — the KeeperHub gap: execution ≠ proof of settlement
2. THE PRIMITIVE   — RENN makes settlement the gate
3. HAPPY PATH      — DECIDES → EXECUTES → PROVES → PAYMENT 2 LOCKED → UNLOCKED
4. TRUST ASSUMPTION— CLAIM PAYMENT #1 → BLOCKED; DELETE PROOF → BLOCKED
5. THE PAYMENT     — CHANGE BENEFICIARY → BLOCKED; CHANGE AMOUNT → BLOCKED
6. THE DEPENDENCY  — proof deleted: EXECUTE #2 EARLY → BLOCKED
                     No proof → no permission → no payment
7. RESTORE TRUTH   — persisted proof restored → PAYMENT 2 UNLOCKED → EXECUTE →
                     PROVEN_SETTLED → CHAIN CLOSED
8. LIVE EVIDENCE   — Polymarket resolution, six sponsored hashes, proof object
                     #001, MEASURED WALLET 0.00 USDC + 0 POL
9. FINAL THESIS    — PAYMENT → PROOF → PERMISSION → PAYMENT
                     PROOF BECOMES PERMISSION
```

**The killer scene** (the one that makes the project legible against a field
full of strong builders):

```
Payment 1 exists.
Payment 1's transaction exists.
Payment 2 exists.
Delete the proof.
Payment 2 cannot move.
```

Not "Payment 1 succeeded" — everyone can show a payment succeeding.

**Narration discipline:** the dashboard has NINE attacks. The video narrates
FOUR, each in a themed step. The other five exist for the judge to click
afterward; on camera they are at most a one-second blocking montage, never
narrated individually.

## Evidence gates (must be true before the respective segment is real)

| Segment | Requires | Marks |
|---------|----------|-------|
| 1–3 (host gap, primitive, happy path) | nothing (dashboard renders the recorded chain) | real two-card unlock animation + proof object #001 |
| 4–6 (attacks) | nothing (engine's own refusals) | CLAIM → `NO VERIFIED TRANSFER`, DELETE PROOF → `PREDECESSOR NOT PROVEN`, CHANGE BEN./AMOUNT → `ENVELOPE MISMATCH`, EXECUTE #2 EARLY → `DEPENDENCY NOT SETTLED` |
| 7 (restore) | nothing (persisted proof still in ledger) | PLAY THE CHAIN replay → UNLOCKED → PROVEN_SETTLED → CHAIN CLOSED |
| 8 (evidence) | `kh_` org key (present) | six sponsored Polygon hashes + `pnpm verify` PROVEN, chain `CLOSED`; measured wallet on-chain |
| 9 (thesis) | the loop just closed | collapse to the equation |

If a segment's prerequisite is missing, say so in the video and stop — no
placeholders dressed as receipts.

## 1. Host failure, not product intro (0:00–0:25)

Black screen:

```
WHAT IF AN AGENT COULD SAY A PAYMENT SUCCEEDED
WHEN THE MONEY NEVER ACTUALLY SETTLED?
```

Beat. Then the exact host gap, plainly:

> "KeeperHub can execute the transaction. But execution alone doesn't tell the
> next payment whether the financial obligation was actually fulfilled."

This is the gap everyone in the room already has — a sponsored execution
confirms a broadcast, not a settlement. No product yet, no architecture.

## 2. Define the new primitive (0:25–0:40)

RENN, big, on the black:

> **"RENN makes settlement the gate. Payment two cannot move until payment one
> is independently proven settled."**

One line: **Settlement is not a receipt. It is permission.**

The judge now knows exactly what they are watching for: does the proof sit in
the authorization path, or is it decorative?

## 3. Show the happy path fast (0:40–1:10)

No architecture talk. Let the state transition prove the primitive.

Polymarket resolves (EVENT FINAL — on-chain payout state).

**RENN DECIDES:** `CONDITION → BENEFICIARY → AMOUNT` (obligation #1 locks).

**KEEPERHUB EXECUTES:** obligation #1 routes to beneficiary (sponsored).

**RENN PROVES:** `EXECUTED → TRANSFER VERIFIED → PROVEN_SETTLED` — Renn re-reads
Polygon itself; the dashboard does not trust the receipt.

Then the important visual — hold it, say almost nothing:

```
PAYMENT 2:   LOCKED → UNLOCKED
```

> "Payment two unlocked *because* payment one is proven settled. Not because a
> status flag flipped. Because a proof exists."

Touch the **proof object #001** panel; read it as an object, not a log:

> "This isn't a status flag. It is a frozen settlement record that obligation
> #002 references as its unlock condition — **UNLOCKS → OBLIGATION #002.**"

## 4. Attack the trust assumption (1:10–1:45)

`#attack`: **ATTACK THIS OBLIGATION.** The red `BLOCKED` is the engine's own
refusal — same `gates.ts` / `chain.ts` / `proof.ts` / `verify.ts` the execute
path runs. No mock, no second source of truth.

First, attack what the system would otherwise have to take on faith:

**CLAIM PAYMENT #1 SUCCEEDED** → `BLOCKED — NO VERIFIED TRANSFER`

> "Execution is not settlement. A confirmed broadcast is not money that moved.
> Renn re-reads the chain for the exact Transfer to the exact beneficiary —
> and you can't just *say* it happened. It has to verify."

Then the killer:

**DELETE SETTLEMENT PROOF** → `BLOCKED — PREDECESSOR NOT PROVEN`

> "The proof isn't a decorative audit record. It is a required artifact in the
> authorization path. Remove it, and the next payment stays locked."

## 5. Attack the payment itself (1:45–2:05)

WNSZNX-style enforcement boundary — the chain cannot be widened or redirected
after the obligation is established:

**CHANGE BENEFICIARY** → `BLOCKED — ENVELOPE MISMATCH`

> "The frozen commitment can't be re-pointed. The envelope hash is keccak-locked
> at arm time — editing the destination voids the obligation itself."

**CHANGE AMOUNT** → `BLOCKED — ENVELOPE MISMATCH`

> "Same reason, same refusal: the terms are set once. An obligation you can
> silently reshape after locking isn't an obligation — it's a suggestion."

Optional one-second montage (no narration): CHANGE CONDITION, RE-POINT
DEPENDENCY, TAMPER PROOF, EXECUTE SETTLED — all BLOCKED.

## 6. Attack the dependency — the strongest shot (2:05–2:20)

The proof is still deleted. Now try to fire the dependent payment anyway:

**EXECUTE OBLIGATION #2 EARLY** → `BLOCKED — DEPENDENCY NOT SETTLED`

Judge sees the entire causal mechanism in one screen:

```
No proof → no permission → no payment.
```

> "With the proof gone, the dependency clock restarts — the child obligation
> cannot even ask to execute. The proof isn't a receipt you file away. It is
> the thing the next payment is waiting for."

One line from the terminal (`pnpm proofs` — gate guarantees in code):

> "The dashboard is a UI. The guarantee lives in code — and we just attacked it
> with the product's own gate functions. Every one held."

## 7. Restore truth, not a UI flag (2:20–2:40)

Cut to `#unlock`. Restoration isn't a reset button — it's returning to the
state that actually exists:

> "Deleting it didn't work — because this is the state that actually exists.
> The proof is persisted in the ledger and re-verifiable on the chain an
> attacker never held. Restore it, and the causal chain resumes."

**PLAY THE CHAIN** (the recorded replay):

```
OBLIGATION #1  LOCKED → EXECUTING → PROVEN_SETTLED ✓
OBLIGATION #2  LOCKED → UNLOCKED BY PROOF #1 → EXECUTING → PROVEN_SETTLED
CHAIN CLOSED
```

> "Control → execution → verification → enforcement → successful completion.
> That's the closed loop: the same proof that refused four attacks is what
> unlocks the legitimate payment."

## 8. Live evidence — after the mechanism is proven (2:40–3:00)

Now expose the receipts. `#proof` — LIVE MAINNET EXECUTION PROOF, each node
PolygonScan-backed:

```
POLYMARKET RESOLUTION   — market #2252243 resolved on CTF
KEEPERHUB EXECUTION     — six sponsored hashes (all sponsored:true)
POLYGON PROOF           — pnpm verify → PROVEN: FINALITY + INTEGRITY +
                          EXECUTION + exact TRANSFER; chain chain-mu59jxk3 CLOSED
PROOF OBJECT #001       — the persisted settlement record that unlocked #002
MEASURED WALLET         — 0.00 USDC + 0.000000 POL (read on Polygon, on screen)
```

Voice:

> "Every transaction above is real and gas-sponsored. And the wallet measured
> **0 USDC** on-chain today — we do not claim a value leg we have not run. The
> moment the org wallet holds ~1 USDC, one command closes that leg too:"

```
pnpm chain --resolved=<finalized A> --chain-resolution=<finalized B> --beneficiary=0x0716… --face=1
```

## 9. Final thesis (3:00–3:10)

The whole UI collapses:

```
PAYMENT → PROOF → PERMISSION → PAYMENT
```

Then, on the black:

> **PROOF BECOMES PERMISSION.**

> "Remove proof of settlement, and the next payment cannot happen."

Repo and docs linked; `README.md` has the full architecture and the exact
evidence list.

## Failure fallbacks

- No USDC in org wallet (current state): film everything except the value leg;
  the measured-0-USDC card in step 8 is itself part of the honesty beat.
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

1. [x] Host-failure open — "What if an agent could say a payment succeeded when the money never actually settled?" + KeeperHub-gap line
2. [x] Happy path: DECIDES → EXECUTES → PROVES → `PAYMENT 2 LOCKED → UNLOCKED` + proof object #001 panel
3. [x] Trust assumption: CLAIM PAYMENT #1 → `NO VERIFIED TRANSFER`; DELETE PROOF → `PREDECESSOR NOT PROVEN`
4. [x] Payment boundary: CHANGE BENEFICIARY + CHANGE AMOUNT → `ENVELOPE MISMATCH`
5. [x] Dependency kill shot: DELETE PROOF then EXECUTE #2 EARLY → `DEPENDENCY NOT SETTLED`; "No proof → no permission → no payment"
6. [x] Restore: PLAY THE CHAIN replay → UNLOCKED BY PROOF #1 → EXECUTING → PROVEN_SETTLED → CHAIN CLOSED
7. [x] Live evidence: six sponsored hashes (chain `chain-mu59jxk3` CLOSED) + `pnpm verify` PROVEN
8. [x] `pnpm proofs` outputs (immutability + blocked + exactly-once + chain) — scratch-ledger run
9. [x] Final thesis collapse: `PAYMENT → PROOF → PERMISSION → PAYMENT` → "PROOF BECOMES PERMISSION."
10. [ ] Screenshot the dashboard with the measured on-chain wallet line (0 USDC → VALUE LEG PENDING COLLATERAL)
11. [ ] Once funded: ONE more Polygon run with real USDC + receipt (completes the value leg)