# Renn — DoraHacks Main Track Submission Packet

**Project name:** Renn (Resolution Enforcement Network)
**One-line pitch:** Commit a payment to an uncertain outcome today. When the
world resolves, KeeperHub settles it only after the outcome is final.
**Category:** Agent Economy — contingent-obligation engine with a finality gate
**Deadline:** September 18 12:00 CEST / 11:00 WAT
**Repo:** `keeperhub-polymarket` (package `renn`)

---

## Problem

Prediction markets are unmatched at pricing an uncertain event. The problem is
what happens to a financial obligation that depends on that event. Today, a
promise like "pay $100 if the Fed cuts 25 bps" is enforced by the counter-party
*remembering to do it* and the recipient *trusting their intent* — after the
result, when interpretation is already possible and the original intent is
long gone.

The decisive fact is that an outcome is not one event, it is two:

1. **A proposal.** Polymarket does not resolve a market in a single moment. The
   outcome is proposed with a review/dispute window; a proposal is provisional.
2. **A final state.** The payout only becomes enforceable when the Conditional
   Tokens contract payout state is final on-chain.

An irreversible financial obligation must not fire off a proposal. Nothing
today anchors settlement to the *final* state, under the obligation that was
*locked before* the event — so users of predictions are left with:

- **Provisional == irreversible.** Naive automation settles on the first signal
  and is wrong in the dispute window.
- **Intent the agent can rewrite.** A workflow whose steps are chosen at
  execution time is not an obligation, it is a suggestion.
- **Settlement you must chase.** Redeeming and routing a payout is never the
  hard part and is always the forgotten part.

## Solution

Renn is a **contingent-obligation engine**. Before the outcome is known, an
obligation is locked — not a policy, not an instruction, an obligation:

```
condition → beneficiary → face value → finality → exact settlement workflow
```

That envelope is keccak-hashed at lock time and re-verified before *every*
execution. Polymarket is the first live source of truth (any resolvable
condition is the long-run target). Renn's state machine then enforces the
two-step reality of resolution:

`ARMED → LOCKED → WAITING_FINALITY → RESOLVED → EXECUTING → SETTLED`

- **LOCKED** — envelope frozen; nobody can later change who, what, or when.
- **WAITING_FINALITY** — outcome proposed but provisional: **SETTLEMENT
  BLOCKED**. No irreversible transaction fires.
- **RESOLVED** — on-chain finality: `payoutDenominator(conditionId) > 0`.
- **EXECUTING → SETTLED** — KeeperHub runs the frozen workflow; obligation
  discharged; every execution id and tx is in the append-only ledger.

The invariant that makes this an obligation and not a script:
**LOCKED OBLIGATION ≠ EDITABLE AGENT INTENT.**

## Why KeeperHub

KeeperHub's model is that an agent authoring a workflow and then executing it
deterministically is the trust boundary — the workflow is reviewed and
simulated before it ever moves money, and execution does not reinterpret it at
run time. Renn needs exactly that, because an enforceable obligation must be
immutable between lock and discharge. Renn deliberately refuses to sign
transactions; the stage that moves money is an ordinary, inspectable KeeperHub
workflow:

1. `web3/read-contract` — `payoutDenominator(conditionId)` on
   `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`.
2. `Condition` gate — proceed only when the payout state is FINAL (non-zero).
3. `web3/write-contract` — the `redeemPositions` redemption path.
4. `web3/transfer-token` — route the face value to the frozen beneficiary.

This is what repurposing agents correctly looks like: the agent *discovers and
locks*, it does not *decide at execution time*. The obligation was the decision;
the workflow is the trust boundary; the ledger is the audit. Custody,
simulation, gas sponsorship, idempotency, and receipt reconciliation all come
from KeeperHub. Renn contributes the finality gate, the redemption math, and
the precommitment contract.

## Architecture

```
                  POLYMARKET                            KEEPERHUB
  Gamma API ──> conditionId ──> on-chain CTF   ──> workflow (read/gate/redeem/route)
       │                │                             │            │
       │                ▼                             ▼            ▼
  market truth     FINALITY GATE:               simulate -> broadcast   status poll
                   proposed  -> WAITING_FINALITY  (success && !revert)   (completed)
                   denom > 0 -> RESOLVED
       └────────────────┴──────────── RENN obligation ledger (append-only JSONL)
```

| Layer | Component | Location |
|-------|-----------|----------|
| Market truth | Gamma API client + on-chain resolution detector | `src/polymarket/` |
| Obligation | `obligationEnvelope()` keccak-hash + promise-of-payment, immutable after lock | `src/policy/obligation.ts` |
| Redemption | CTF / NegRiskAdapter redemption, ABI-verified against live CTF | `src/polymarket/redemption.ts` |
| Execution | KeeperHub workflow composer + safe direct-execution client | `src/keeperhub/` |
| Policy | Append-only state machine (ARMED → … → SETTLED) | `src/policy/` |
| Surface | CLI (`arm`, `status`, `watch`, `execute`, `prototype`, `demo:*`, `sanity`) + live console | `src/index.ts`, `dashboard/` |
| Demo | Deterministic, real-mainnet CTF condition under Renn's control | `src/polymarket/demo-engine.ts` |

## Exact live sequences

### KeeperHub-executed prototype (transaction evidence)

`pnpm prototype --beneficiary=…` creates a CTF condition itself and executes the
entire lifecycle *through KeeperHub*, sponsored, from the organisation's Turnkey
wallet — no local signing at all:

| Step | KeeperHub execution (all on Polygon mainnet) | Obligation state |
|------|-----------------------------------------------|------------------|
| 1 | `approve(USDC → CTF, amount)` | ARMED → LOCKED |
| 2 | `prepareCondition(wallet, 0, cond, 2)` | LOCKED |
| 3 | `splitPosition(USDC, 0, cond, [1,2], amount)` | LOCKED (positions held) |
| 4 | pre-resolution read arm: **`WAITING_FINALITY` — SETTLEMENT BLOCKED** (irreversible nothing fires) | WAITING_FINALITY |
| 5 | `reportPayouts(cond, [1,0])` | RESOLVED (after `denom > 0` verified) |
| 6 | `redeemPositions(USDC, 0, cond, [1,2])` + `transfer(USDC → beneficiary)` | EXECUTING → SETTLED |

Every hop is recorded in `.data/prototype.jsonl` and the ledger with its
execution id and tx hash. Requires only ~1 USDC of collateral in the org wallet
(`0x9f7de2b79d93adb3d3ef6501ca6d8c8c00a2e6fc`); gas is sponsored.

### Deterministic local demo (cross-check harness, optional)

Five real Polygon mainnet transactions under Renn's control (self-created CTF
condition, signed locally): bootstrap (`prepareCondition` + `splitPosition`,
25→1 USDC) → resolve (`reportPayouts`) → distribute (`redeemPositions` + USDC
`transfer`) → `pnpm status` / `pnpm dashboard`. Budget ≈ 0.06-0.23 POL + 1 USDC;
`pnpm demo:preflight` prints the exact live figure.

### Live market

The real September 2026 FOMC market (2252243, ~$48M volume) is armed
(`policy-2252243`); after Sept 16 finality, `pnpm execute --policy-id=…` drives
the redemption through the simulate → broadcast → status-poll loop in
`src/keeperhub/client.ts`.

## What is live vs what requires funded execution

**Verified live already (no funding required):**
- All four Polymarket contracts confirmed present on Polygon mainnet.
- CTF ABI / function selectors / position-ID math validated against the live CTF.
- Finality gate: `payoutDenominator == 1` on already-resolved markets, `0` on a
  proposed-only state; `watch` moves a policy to WAITING_FINALITY on the
  provisional signal and to RESOLVED only on final payout state.
- Obligation-envelope hashing and the re-verify-on-execute gate.
- Ledger state machine and workflow-envelope composition via `pnpm arm` /
  `pnpm status`.

**Real sponsored KeeperHub execution already on-chain (DONE):**
- `pnpm sanity` landed a real USDC-Base `approve(0)` on Base mainnet from the
  empty org Turnkey wallet, gas fully sponsored — `executionId
  ae9x3lx6lkyyfmw0wkk20`, tx
  `0xd92588006e3592ad5cffbae53c6478e64f66bf656a024944fd17d836ae511c6d`
  (BaseScan, `completed`, `sponsored=true`). The sponsored-execution leg of the
  paper trail.
- **Layer-1 zero-value redemption proof (Polygon):** three real sponsored
  Polygon mainnet transactions from `pnpm zero-value` against a real,
  already-finally-resolved Polymarket condition (`denom=1`, gate OPEN on-chain),
  empty org wallet, zero collateral:
  1. `approve(CTF, 0)` — `executionId dblyr1n2ahek4iegwi96b`,
     tx `0x1579c791f0cecb8fb335702444cc2a117088769873218f6dc35560cd2239264a`
     (sponsored=true)
  2. `redeemPositions` on condition `0x0c481aa63ec6…eae0` —
     `executionId a9o7uh3k9mth5mhnmeoay`,
     tx `0xc7953f3264ec519651cd15ec45beb4ad39375b008d40a1478fb437485388ff77`
     (sponsored=true)
  3. `transfer(0)` to beneficiary — `executionId y3729jn0stn1xmdmafg6h`,
     tx `0x2c453a77967e4616395bc75c564a672cbaf873a268c03b3cfa382a5b425f45b1`
     (sponsored=true)
  All three in `.data/zero-value.jsonl`. Proves the finality gate opens only
  on real on-chain resolution and the redemption path executes through
  KeeperHub at a real finally-resolved condition — no self-created condition,
  no collateral needed.

**PENDING — requires ~1 USDC in the org wallet on Polygon (sponsored gas):**
- `pnpm prototype --beneficiary=…` — the full six-hop KeeperHub-executed
  lifecycle above. This is the transaction evidence the rubric asks for; every
  hop lands a real hash into the evidence table below.

**PENDING — blocked by design until FOMC finality:**
- `pnpm execute --policy-id=policy-2252243` redemption; the gate refuses to run
  it while the payout state is provisional, which is the safety property being
  demonstrated.

**Sub-$1 funded local harness (cross-check only, NOT the product):**
- The deterministic demo loop's hashes (~0.06-0.23 POL + 1 USDC principal,
  throwaway EOA, exact figure from `demo:preflight`).

The product is the KeeperHub execution layer backed by the finality gate; the
local harness is an independent re-execution of the same mechanism.

## Repo setup

```bash
pnpm install
cp .env.example .env          # add KEEPERHUB_API_KEY (free, kh_ org key)
pnpm typecheck                # green
pnpm status                   # starts empty
pnpm dashboard                # live console: http://localhost:8787
pnpm prototype --beneficiary=<addr>   # sponsored lifecycle proof (~1 USDC in org wallet)
```

No server, no bot network, no cloud dependency.

## Demo video script

See `docs/demo-script.md` (3-minute capture script). Footer of the dashboard
and every evidence block is marked **EVIDENCE PENDING** until real hashes are
inserted; no fake receipts, no fake live execution.

## Transaction / evidence placeholders

| Evidence | Where it lands | Status |
|----------|----------------|--------|
| `sanity` sponsored tx (Base) | `pnpm sanity` | **DONE** — `0xd92588006e…511c6d` (sponsored, approval 0) |
| Layer-1: `approve(CTF, 0)` (Polygon) | `pnpm zero-value --resolved=…` | **DONE** — `0x1579c791…264a` (sponsored) |
| Layer-1: `redeemPositions` (real resolved condition, gate OPEN) | `pnpm zero-value --resolved=…` | **DONE** — `0xc7953f32…ff77` (sponsored) |
| Layer-1: `transfer(0)` to beneficiary | `pnpm zero-value --resolved=…` | **DONE** — `0x2c453a77…f45b1` (sponsored) |
| Prototype: full lifecycle (approve/create/split/block/resolve/redeem/route) | `pnpm prototype` | PENDING (~1 USDC in org wallet) |
| FOMC redemption execution | `pnpm execute --policy-id=policy-2252243` | PENDING (blocked until final) |
| Local demo loop (5 hashes) | `pnpm demo:*` | PENDING (optional cross-check) |
| On-chain resolution + ABI + finality-gate verification | README "Evidence status" | DONE |

Hashes are appended automatically to `pnpm status` output and the dashboard when
each step runs; nothing requires hand-editing.

## Security and trust

- **Obligation immutability.** Envelope hash is re-derived before every
  execution; mismatch aborts (`LOCKED OBLIGATION MISMATCH`). The beneficiary
  cannot be swapped after lock.
- **Finality gate.** A provisional outcome moves the obligation to
  `WAITING_FINALITY` and settles nothing (`SETTLEMENT BLOCKED`); money only
  moves on the final on-chain payout state.
- **Every broadcast is preflighted live** (simulate, `success` +
  `wouldRevert:false`) before it is signed.
- **Renn never holds or signs;** KeeperHub does.
- **Full history is reconstructable** from `.data/ledger.jsonl`.

## Roadmap

- Multi-condition obligations (one envelope, N conditions, proportional
  routing).
- AutoRedeemer + exchange-settlement support for new-gen markets.
- KeeperHub schedule-trigger hybrid: resolution observation via `watch` plus
  deterministic re-run on missed windows.
- Shared keepers: one wallet settles on behalf of many, treasury fee.
- Audits: KeeperHub's own workflow filters (forbid bare egress, plugin checks)
  already constrain the execution surface.