# Renn — Arc Testnet Bounty Packet

**Bounty:** Arc Testnet chain registration (KeeperHub issue #2230)
**Deliverable:** merged PR adding Arc Testnet to KeeperHub's chain support
**Companion to:** Renn main-track submission (see `submission.md`)

---

## PR summary

Adds **Arc Testnet** (`chainId 5042002`) as a first-class network in
KeeperHub: RPC config, chain seeding for the web3 plugin, token metadata,
explorer wiring, and the test keeping it all pinned.

## Feature description

Arc Testnet is a next-generation EVM testnet (the live testbed for the Arc
network, designed for fast, low-cost settlement of AI-agent and automation
traffic). KeeperHub already supports Ethereum, Base, Sepolia, and Tempo; Arc
Testnet is a natural addition because its positioning — cheap settlement for
autonomous agents — is exactly the workload KeeperHub workflows execute.
Registering it means a workflow can read, write, and transfer tokens on Arc
Testnet with the same typed web3 steps used anywhere else: no plugin rewrite,
no bespoke path.

- `lib/rpc/rpc-config.ts` — adds the `ARC_TESTNET` RPC URL and the
  `5042002` entry under `CHAIN_CONFIG`.
- `scripts/seed/seed-chains.ts` — adds Arc Testnet to `DEFAULT_CHAINS`,
  explorer config templates, and the chain-id-to-default-id map so the web3
  plugin resolves network → chain without special-casing.
- `scripts/seed/seed-tokens.ts` — seeds Arc Testnet's USDC deployment so
  token-aware steps (`approve`, `transfer`) have correct metadata.
- `plugins/blockscout/chains.ts` — wires the Blockscout explorer
  (`https://testnet.arcscan.app`) for browser/verifier integration on Arc
  Testnet.
- `tests/unit/rpc-config.test.ts` — guards the `arc-testnet` network key and
  its chain lookup.

## Files changed

| File | Change |
|------|--------|
| `lib/rpc/rpc-config.ts` | `ARC_TESTNET` RPC + `CHAIN_CONFIG[5042002]` |
| `scripts/seed/seed-chains.ts` | `DEFAULT_CHAINS` + explorer template + chainId map |
| `scripts/seed/seed-tokens.ts` | Arc Testnet USDC metadata |
| `plugins/blockscout/chains.ts` | `https://testnet.arcscan.app` |
| `tests/unit/rpc-config.test.ts` | `arc-testnet` coverage |

## Tests

- `pnpm type-check`: green.
- `pnpm fix` (biome, Ultracite): clean — "Checked 2275 files, no fixes applied".
- `vitest run tests/unit/rpc-config.test.ts`: 112/112 pass.
- Full suite: **653 test files, 24,405 tests, all passing.**

## Why Arc Testnet belongs in KeeperHub

1. **It is the same workload.** Arc Testnet was built for cheap, reliable
   settlement of autonomous-agent transactions — the exact ground KeeperHub
   workflows stand on. Chains that power agents should be first-class targets
   of an agent-execution platform.
2. **Zero-cost testing.** A testnet with no faucet friction lets builders
   validate workflow execution, sponsored-gas paths, and redemption loops
   before committing mainnet capital. That is precisely how Renn validates its
   Polymarket redemption machinery.
3. **Symmetry with the agent economy theme.** The hackathon asks for agents
   that actually move money; giving them a safe testbed is infrastructure for
   that, not decoration.

## Separate BUIDL submission text (paste into the Arc bounty form)

> Adds Arc Testnet (`5042002`) to KeeperHub as a fully wired network: RPC
> config, chain seeding for the web3 plugin, USDC token metadata, Blockscout
> explorer, and a unit-test guard. Any workflow web3 step (read/write/transfer)
> now treats Arc Testnet like any other EVM network. Full suite passes:
> 653 files / 24,405 tests, biome clean, type-check green.