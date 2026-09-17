# RENN

### The next payment only unlocks when the previous payment is proven.

RENN lets agents and applications build financial workflows where settlement becomes executable state.

```text
EVENT
  ↓
OBLIGATION
  ↓
PAYMENT
  ↓
PROOF
  ↓
NEXT PAYMENT
```

> A transaction receipt is not enough.
> A successful execution is not enough.
> RENN independently verifies the actual on-chain settlement before allowing the dependent obligation to execute.

---

**Renn — deterministic settlement gates for agentic onchain execution.**

Prediction is probabilistic. **Settlement isn't.**

Renn turns future outcomes into enforceable obligations: when an agent's
decision depends on an external onchain outcome, Renn prevents that decision
from becoming an irreversible payment until the outcome is **final** and the
authorized obligation still holds. It is finality-gated, immutable, exactly-once
and **independently verified after settlement** — not merely transported by
KeeperHub.

```
LIVE EVENT                     (Polymarket condition, on-chain)
    ↓
FINALITY PROOF                 (CTF payoutDenominator > 0 — never a proposal)
    ↓
IMMUTABLE OBLIGATION           (keccak-frozen: beneficiary, face value, workflow)
    ↓
KEEPERHUB REDEEM               (redeemPositions on the CTF, sponsored)
    ↓
KEEPERHUB USDC SETTLEMENT      (transfer the obligated USDC to the beneficiary)
    ↓
INDEPENDENT EXACT TRANSFER PROOF   (re-read chain: exact ERC20 Transfer event)
    ↓
PROVEN FINANCIAL STATE         (obligation #1 SETTLED + proof persisted)
    ↓
PROOF-GATED NEXT OBLIGATION    (obligation #2 references #1's proof; gate 1.5)
    ↓
KEEPERHUB EXECUTION            (obligation #2 redeem + settlement, sponsored)
    ↓
SECOND PROOF                   (exact Transfer event verified again)
    ↓
CHAIN CLOSED
```

The last loop is the point: a proven settlement is not the end of the story —
it is **executable state**. Obligation #2's unlock condition is obligation #1's
independently verified `PROVEN_SETTLED` **settlement proof**, frozen into #2's
envelope at arm time. Settlement proof stops being a receipt and becomes the
authorization for the next obligation.

**REAL POLYGON PROOF — chain closed.** One live chain, two obligations, six
sponsored Polygon mainnet transactions from an empty org wallet, executed by
KeeperHub against two real, finally-resolved Polymarket conditions (gate OPEN
on-chain). Obligation #2 executed **only because** obligation #1 was
independently `PROVEN_SETTLED`:

```
CHAIN CLOSED — chain-mu59jxk3

  OBLIGATION #1  policy-acb077c5   PROVEN_SETTLED   condition 0x0c481aa6…eae0
    approve  tx 0xf70b1f7961f00dda…fb2decbd2
    redeem   tx 0x65005ee0e187ecf6…daf51adb74   KeeperHub dmr1g67zmpejb6f94i8hp
    route    tx 0x21a05f325036b074…910ac303     KeeperHub kcdpl20ya8ddd315z35jo
  →  proof verified on chain (FINALITY + INTEGRITY + EXECUTION + exact TRANSFER)

  OBLIGATION #2  policy-3f07ac4b   PROVEN_SETTLED   condition 0x3733a1b6…9b3868
    UNLOCKED BY policy-acb077c5 PROVEN_SETTLED   (gate 1.5, fail-closed)
    approve  tx 0x29e3824c11202e56…a61956ba6
    redeem   tx 0x6588bfc4ab65bb5f…c22a1551     KeeperHub kgnq0yepac4wiksc6wcf2
    route    tx 0xb76fbaa71f4b0ac3…c3429bae     KeeperHub a56nmmxi3ib9hzgydfwgk

  CHAIN CLOSED — 2 obligations, value 0 USDC per leg (pending collateral)
```

**ZERO ASSET VALUE / NONZERO PENDING.** Every transaction above is real and
sponsored on Polygon mainnet, but moves **zero USDC** — so the *mechanism*
(including the unlock gate) is proven while the *value* leg is not. Completing
value settlement needs ~1 USDC in the org wallet
`0x9f7de2b79d93adb3d3ef6501ca6d8c8c00a2e6fc` (gas sponsored); the identical
chained path then moves face value. Until then the submission claims only what
is proven and marks the rest PENDING.

Part of the KeeperHub "Agent Economy" Hackathon (main track) and the Arc
Testnet chain-registration bounty (issue #2230, PR merged alongside).

## The primitive

An outcome-dependent financial obligation — "pay Bob $100 USDC if the Fed cuts
25 bps" — is not a promise someone fulfills later. It is an economic object
whose settlement condition can be **locked, verified, and enforced** before the
event occurs:

- **Locked, not hoped.** The obligation envelope is hashed at arm time and
  re-verified before every execution:
  `condition → beneficiary → face value → finality → exact settlement workflow`.
  `LOCKED OBLIGATION ≠ EDITABLE AGENT INTENT`.
- **Finality-gated, not event-gated.** Polymarket resolutions are proposed and
  only become final against the CTF payout state. Settlement is blocked while a
  proposal is provisional (`WAITING_FINALITY`).
- **Deterministic, not interpretive.** The workflow that reads the resolution is
  the one that moves the money. The agent discovers the condition; it can never
  rewrite the commitment afterward.

Polymarket is the first live source of truth; the layer itself is general to any
resolvable event.

## Why this matters

The hard problem is not collecting a payout. It is the gap between "something
happened" and "money is safe to move". Polymarket's outcome passes through a
proposal and challenge window before it becomes final; an irreversible
financial obligation cannot execute off a preliminary oracle proposal. That gap
is exactly where Renn sits.

An obligation created before the event — against a Polymarket position —
becomes actionable because its settlement path no longer depends on anyone
remembering, reinterpretating, or approving it later:

- The beneficiary can rely on the obligation before resolution: who gets paid,
  how much, and under which final condition are already frozen.
- Nothing single-points on a human: no manual redemption, no "please pay" mail,
  no re-read of a market page at 4am.
- The whole pipeline is auditable *before* a single share is bought.

## The closed loop

```
1. ARM      — declare an obligation: condition, beneficiary, face value.
2. LOCK     — hash the envelope; nobody can later change who/what/when.
3. WAITING  — outcome proposed: SETTLEMENT BLOCKED until payout state is final.
4. RESOLVED — on-chain finality: CTF payoutDenominator(conditionId) > 0.
5. EXECUTE  — KeeperHub runs EVERY write node: redeem + route (settlement).
6. VERIFY   — independent chain re-read: finality + integrity + confirmed
              distribution tx + exact ERC20 Transfer event.
7. SETTLED  — proof persisted; execution id + tx + verification in the ledger.
8. CHAIN    — that proof unlocks a chained obligation (dependsOn); it repeats 4-7.
```

Each stage is a tracked state in `src/policy/ledger.ts`. Transitions are only
driven by on-chain evidence. `payoutDenominator` on the Polymarket Conditional
Tokens contract is the only thing that moves an obligation to EXECUTING; a
provisional proposal only ever produces `WAITING_FINALITY`. The execute path
runs **all** write nodes in the staged workflow (`redeem` **and** `route`) — a
redemption without the distribution can never close. Settlement closes as
`SETTLED` only when `pnpm verify` proves finality, integrity, the confirmed
distribution transaction, and an **exact** `Transfer(USDC → beneficiary,
faceValue)` event — never on KeeperHub's receipt alone, and never on a
"beneficiary balance ≥ face value" heuristic.

The chain stage is enforced by gate 1.5 (`src/policy/chain.ts`): a chained
obligation cannot execute until its predecessor is independently `PROVEN_SETTLED`
on chain **and** has a valid persisted settlement proof (`src/policy/proof.ts`)
that the child references — `state === SETTLED` alone is not enough. The
dependency itself is part of the frozen envelope, so re-pointing it changes the
hash and voids the obligation. `pnpm chain` runs the whole thing end to end.

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

- Renn owns the **decision state machine** (armed/locked/resolved/etc.) and
  the **on-chain truth reads** (resolution, balances, position IDs).
- KeeperHub owns the **execution**: custody of the wallet, simulation, gas
  sponsorship, idempotent broadcast, and receipt reconciliation.
- Renn never signs and never holds keys. The money logic is a normal,
  inspectable KeeperHub workflow.

## Why KeeperHub

The execution is KeeperHub's job, not ours — and it is load-bearing, not
convenient. KeeperHub's model is that an agent authors the workflow once, the
workflow is reviewed/simulated, and execution is deterministic rather than
reinterpreted at execution time. That is precisely the property an enforceable
obligation needs: the agent can discover the condition, but it can never rewrite
the commitment after it is locked. Renn composes the workflow with
`web3/read-contract`, a gate, `web3/write-contract` and `web3/transfer-token`
nodes and hands it to KeeperHub:

| KeeperHub step            | Role                                                  |
|---------------------------|-------------------------------------------------------|
| `web3/read-contract`      | read `payoutDenominator(conditionId)` on the CTF      |
| `Condition` gate          | continue only when the payout state is FINAL (> 0)    |
| `web3/write-contract`     | `redeemPositions` on the CTF redemption path          |
| `web3/transfer-token`     | route the face value to the frozen beneficiary        |

The workflow is emitted as a plain JSON envelope (`src/keeperhub/workflow.ts`)
that can be imported into the KeeperHub builder, driven over the API surface,
or executed directly. The safe write is always simulate → `success &&
wouldRevert:false` → one broadcast under a fresh `Idempotency-Key` → poll to a
terminal status, all verified (`src/keeperhub/client.ts`).

## Redemption paths

- **Classic CTF redemption** — `redeemPositions(collateral, parent, condition,
  [1, 2])` on the Polymarket Conditional Tokens contract
  (`0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`). No approval required.
- **NegRisk redemption** — `redeemPositions(conditionId, [1, 2])` on the
  NegRisk adapter (`0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`), gated by a
  one-time `setApprovalForAll` step the workflow can include automatically.
- **AutoRedeemer / exchange settlement** — for new-generational CLOB markets,
  resolution settlement is observed and the routing step still applies.

All redemption paths run on Polygon mainnet (chain 137), the chain Polymarket
uses. USDC collateral: `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359`.

## The KeeperHub-executed prototype (no local signing)

The cleanest proof of the loop is `pnpm prototype`: Renn creates its own CTF
condition and executes the *entire* lifecycle through KeeperHub against the
organisation's Turnkey wallet — approve → create condition → split → *WAITING
FINALITY (settlement blocked)* → resolve → verify final on-chain → redeem →
route to the beneficiary. Every hop is a real sponsored Polygon mainnet
execution (execute → receipt), and every hop is recorded in
`.data/prototype.jsonl` and the ledger.

```bash
pnpm prototype --beneficiary=0x… [--face=1] [--winner=YES]
```

The only external input is ~1 USDC of collateral sitting in the org wallet
(`pnpm sanity`'s wallet address): `0x9f7d…e6fc`. Gas is sponsored, so nothing
else is needed. This is the transaction evidence the hackathon rubric requires
of a live integration.

## Deterministic demo mode (local signing harness)

The fastest way to see the whole loop locally, using the *real* Polymarket CTF
contract with a condition Renn creates and signs itself:

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
purpose: the whole five-transaction loop runs inside a budget of about
0.06-0.23 POL plus 1 USDC of principal. Keep only that tiny balance in the
demo wallet; it is a throwaway key. This harness is **our funded proof
harness, not a product requirement** — the product runs on KeeperHub's
sponsored execution.

## Live event mode

```bash
pnpm market:find                      # list markets resolving in the next 7 days
pnpm arm --market=<id> --treasury=<addr> [--face=<usdc>]
pnpm watch                            # poll: provisional -> WAITING_FINALITY (blocked); final -> RESOLVED
pnpm execute --policy-id=<policy-id>  # settle only the frozen obligation (finality + hash verified)
pnpm sanity                           # zero-value sponsored execution proof (empty wallet, real tx)
pnpm prototype --beneficiary=<addr>   # full KeeperHub-executed lifecycle (sponsored)
pnpm proofs                           # zero-funding gate proofs: immutability + blocked + exactly-once + chain
pnpm test                             # correctness suite: exact-transfer verify, chain gating, gates, ledger retry
pnpm verify --policy-id=<id>          # independent on-chain settlement verification (PROVEN/BLOCKED/DISPUTED)
pnpm zero-value --resolved=<cond> --parent=<parent> [--beneficiary=<addr>]   # Layer-1 proof on a really-resolved condition
pnpm chain --resolved=<condA> --chain-resolution=<condB> [--beneficiary=<addr>]   # full two-obligation chain -> CHAIN CLOSED
pnpm site:export                      # static, backend-free dashboard in dist/index.html (deploy to any host)
```

`execute` refuses two things before it ever broadcasts: a **provisional
outcome** (`SETTLEMENT BLOCKED` — no irreversible obligation fires off a
preliminary result) and an **edited obligation** (the recomputed envelope hash
must equal the hash frozen at arm time). It also re-reads the CTF payout state
live and, for a chained obligation, requires the predecessor's proof. For a real
execution it runs **every write step** in the staged workflow — `redeem` then
`route` — dry-running each (`simulate: true`), requiring `success: true` and
`wouldRevert: false`, broadcasting under a fresh `Idempotency-Key`, and polling
to a terminal status. Both execution ids / tx hashes are recorded in the ledger.

`sanity` already landed a real `approve(spender, 0)` on USDC (Base mainnet)
from an organisation wallet with zero native balance — `executionId
ae9x3lx6lkyyfmw0wkk20`, sponsored, value 0 (see Evidence status below).

Featured market: the September 2026 FOMC rate decision (market 2252243,
"Is the Fed decreasing rates by 25 bps after the September 2026 meeting?",
~$48M volume) — adjacent to the hackathon window; the deterministic prototype
demonstrates the identical mechanism on demand.

## Environment

| Variable | Purpose |
|----------|---------|
| `EOA_PRIVATE_KEY` | wallet that owns the positions (local funded proof harness only) |
| `EOA_ADDRESS` | its address (used by `demo:preflight` balance reads) |
| `TREASURY_ADDRESS` | the frozen obligation beneficiary / enforced payout destination |
| `KEEPERHUB_API_KEY` | org API key (`kh_…`) for simulation + sponsored execution |
| `KEEPERHUB_API_BASE` | default `https://app.keeperhub.com` |
| `MARKET_ID` | default market for `pnpm arm` |
| `POSITION_VALUE_USDC` | position size used in staged workflows |
| `DEMO_AMOUNT_USDC` / `DEMO_WINNER` | deterministic demo parameters (default 1 USDC, YES) |

The `kh_` org key is required for the sponsored execution path (`sanity`,
`execute`, `prototype`). The `EOA_PRIVATE_KEY` + sub-$1 funding is required for
**our funded local proof harness** only; it is not a product requirement.

## Security model

- **Obligation immutability.** The envelope
  (`condition → beneficiary → face value → finality → settlement workflow`) is
  keccak-hashed at arm time; every execution re-derives the hash from the live
  policy and refuses to broadcast on mismatch.
  `LOCKED OBLIGATION ≠ EDITABLE AGENT INTENT`.
- **Finality gate.** A provisional resolution hits `WAITING_FINALITY` and
  *stays there* — settlement is blocked (`SETTLEMENT BLOCKED`). Execution only
  proceeds when `payoutDenominator` is non-zero on Polygon.
- **Exactly-once.** Settlement consumes the execution authorization (gate 0);
  a `SETTLED` obligation refuses further payment (`ALREADY SETTLED`). A failed
  execution stays alive under the same frozen hash for retry — never a new
  payout.
- **Chain gate (proof as authorization).** A chained obligation fires only
  after its predecessor is independently verified `PROVEN_SETTLED` on chain
  **and** carries a valid persisted settlement proof the child references
  (gate 1.5, `src/policy/chain.ts` + `src/policy/proof.ts`). The dependency is
  part of the frozen envelope, so it cannot be re-pointed after locking.
- **Exact-transfer verification, not a balance guess.** The VERIFY stage
  (`src/policy/verify.ts`) parses the distribution receipt and requires an
  exact `Transfer(USDC → beneficiary, faceValue)` event attributable to that
  execution. A settled-but-unproven balance can never stand in for proof.
- **Redemption is not settlement.** The execute path runs every write node in
  the staged workflow; a redemption without the USDC distribution is recorded
  as `FAILED` (retryable) and can never become `SETTLED`.
- **Preflight the write.** Every broadcast is preceded by a live simulation;
  anything that would revert does not get signed.
- **Append-only ledger.** Every state change and execution hop is appended to a
  replayable JSONL ledger (`src/policy/ledger.ts`); the whole history is
  reconstructable from the file.
- **Receipt-backed.** Each step records its execution id, tx hash and explorer
  link; the dashboard and CLI surface them for independent verification.
- **No secret handling in Renn.** Renn never signs; KeeperHub's wallet
  infrastructure does.

## Evidence status

Every claim in the submission is either verified or explicitly marked PENDING;
nothing is faked.

- Verified (no funds needed): Polymarket contract presence, CTF ABI and
  selectors, resolution reads, position ID math, obligation-envelope hashing,
  workflow envelope composition, ledger state machine, finality gate logic.
- **DONE — real sponsored KeeperHub execution (sanity):** zero-value
  USDC-Base `approve(0)` on Base mainnet from the organisation's empty Turnkey
  wallet, fully gas-sponsored — `executionId ae9x3lx6lkyyfmw0wkk20`,
  tx `0xd92588006e3592ad5cffbae53c6478e64f66bf656a024944fd17d836ae511c6d`
  (BaseScan), status `completed (sponsored=true)`, on-chain Approval event
  with value 0. Part of the paper trail.
- **DONE — Layer-1 zero-value redemption proof (Polygon):** the locked
  obligation -> finality-gate -> redemption -> routing path executed by
  KeeperHub against a REAL, already-finally-resolved Polymarket condition
  (`denom=1`, gate OPEN on-chain), sponsor-gas, EMPTY org wallet. All three
  hops are real Polygon mainnet transactions:
  1. `approve(CTF, 0)` — `executionId dblyr1n2ahek4iegwi96b`,
     tx `0x1579c791f0cecb8fb335702444cc2a117088769873218f6dc35560cd2239264a`
  2. `redeemPositions` on condition `0x0c481aa6…eae0` (Credible FDV >$100M,
     finally resolved on-chain) — `executionId a9o7uh3k9mth5mhnmeoay`,
     tx `0xc7953f3264ec519651cd15ec45beb4ad39375b008d40a1478fb437485388ff77`
  3. `transfer(0)` to the beneficiary — `executionId y3729jn0stn1xmdmafg6h`,
     tx `0x2c453a77967e4616395bc75c564a672cbaf873a268c03b3cfa382a5b425f45b1`
  Receipts: `.data/zero-value.jsonl` (all `sponsored:true`). This proves the
  finality gate opens only on real on-chain resolution and the redemption path
  executes through KeeperHub at a real finally-resolved condition — without
  self-creating a condition or needing collateral.
- **DONE — gate proofs (`pnpm proofs`, zero-funding):** four hard guarantees
  demonstrated live from the same modules the product uses, against a scratch
  ledger (`.data/proofs/`): (1) obligation immutability — tampering the
  beneficiary, face value, or condition after locking yields a different
  envelope hash and the execute path refuses (`LOCKED OBLIGATION MISMATCH`);
  (2) finality gate — a `WAITING_FINALITY` policy is refused before any
  broadcast (`SETTLEMENT BLOCKED … No irreversible obligation fires on a
  preliminary result`); (3) exactly-once — a `SETTLED` obligation refuses
  duplicate execution (`ALREADY SETTLED`); (4) obligation chain — a chained
  obligation whose predecessor is only `LOCKED` is refused
  (`OBLIGATION CHAIN BLOCKED`), and re-pointing the predecessor changes the
  frozen envelope hash. The FOMC market is now **finally resolved on-chain
  (denom 1)**, so the same finality gate demonstrably *opens* for the real
  conditional payment.
- **DONE — obligation chain, live and CLOSED (`pnpm chain`):** two chained
  obligations executed through KeeperHub on two real finally-resolved
  conditions. Obligation #1 `policy-acb077c5` settled and was independently
  PROVEN; obligation #2 `policy-3f07ac4b` (frozen with `dependsOn
  policy-acb077c5`) was **unlocked only because #1 was PROVEN_SETTLED** (gate
  1.5), executed, and was itself independently PROVEN. Six sponsored Polygon
  mainnet transactions, empty org wallet. Chain `chain-mu59jxk3` reads
  **CLOSED** in `pnpm status` and on the dashboard. Value 0 USDC per leg
  (pending collateral) — the mechanism is proven, the value leg is not claimed.
- **DONE — independent verification (`pnpm verify`):** the
  real Layer-1 obligation is re-read from Polygon and proven settled on chain:
  FINALITY (denom 1) + INTEGRITY (envelope hash intact) + EXECUTION (confirmed
  distribution tx, KeeperHub `y3729jn0stn1xmdmafg6h`) + exact TRANSFER event.
  Settlement is PROVEN, not assumed; the same VERIFY stage gates every future
  execution (`EXECUTING → VERIFYING → SETTLED`).
- **DONE — correctness suite (`pnpm test`, 30 tests, no network):** exact
  `Transfer(USDC → beneficiary, amount)` matching (wrong beneficiary / amount /
  token all fail); persisted proof integrity (tampered payload rejected);
  proof-gated chaining (absent / unsettled / unproven predecessor blocks,
  proven predecessor unlocks); provisional resolution blocks execution; edited
  obligation hash blocks execution; redemption-without-distribution cannot
  verify; failed-child retry preserves the same frozen hash; settled obligation
  cannot execute twice; zero-value verification is kept separate.
- Evidence path to a filled paper trail:
  1. `pnpm prototype --beneficiary=…` — the full six-hop lifecycle
     (approve/create/split/block/resolve/redeem/route) executed by KeeperHub.
     **Marked PENDING** until ~1 USDC collateral sits in the org wallet
     `0x9f7d…e6fc` on Polygon; gas is sponsored.
  2. Live-value settlement on the FOMC policy (`pnpm execute
     --policy-id=policy-2252243`): gate is OPEN on chain now (denom 1); still
     needs ~1 USDC to move; **marked PENDING** until the wallet is funded.
  3. The funded local demo loop (EOA 0x…74e1, ~2 USDC) as a cross-check of the
     same mechanism with no KeeperHub dependency.
- Dashboard ships with an explicit **LIVE MAINNET EXECUTION PROOF — ZERO ASSET
  VALUE** strip (real recorded sponsored hashes from the ledger) and a separate
  **NONZERO SETTLEMENT — PENDING COLLATERAL** marker — the value leg is never
  claimed as completed until collateral lands.

## Detail docs

- `docs/submission.md` — DoraHacks main-track submission packet.
- `docs/arc-bounty.md` — Arc Testnet chain-registration bounty packet (PR #2230).
- `docs/demo-script.md` — the demo video script with the evidence checklist.