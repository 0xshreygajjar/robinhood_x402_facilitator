# Robinhood Chain support

This fork of OpenFacilitator settles x402 `exact` payments on Robinhood Chain (mainnet and testnet) using USDG (Global Dollar) via ERC-3009 `transferWithAuthorization`. No Permit2 path is needed.

## What was added

| Area | Change |
|------|--------|
| `packages/core/src/chains.ts` | Chain `4663` (`robinhood`, `eip155:4663`) and `46630` (`robinhood-testnet`, `eip155:46630`) in the registry, network/chain-id/CAIP-2 maps, production/test lists. |
| `packages/core/src/robinhood.ts` | viem `defineChain` definitions (the installed viem 2.43 does not ship them), used for public clients (`facilitator.ts`) and settlement (`erc3009.ts`). |
| `packages/core/src/tokens.ts` | `USDG` in `knownTokens`; mainnet USDG in `defaultTokens`, testnet USDG in `testTokens`. |
| `packages/core/src/eip712.ts` | Per-token EIP-712 domain override map (USDG = `Global Dollar` / `1`), typed-data builder and signature check. Client-supplied `extra.name` / `extra.version` take precedence. |
| `packages/core/src/facilitator.ts` | `/verify` now recovers the `TransferWithAuthorization` signer and rejects a signature that does not match `from`, **only for tokens in the override map** (USDG). All other tokens keep the previous behaviour (signature validated by the token contract at settlement). |
| `packages/sdk`, dashboard, skills docs | Robinhood added to network lists, explorer links and docs tables. |
| `packages/core/src/robinhood.test.ts` | 11 offline vitest tests. |
| `packages/integration-tests/scripts/robinhood-smoke.ts` | Manual smoke script (never run automatically). |

## Verified token facts

- USDG, 6 decimals. Testnet `0x7E955252E15c84f5768B83c41a71F9eba181802F`, mainnet `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`.
- Both implement EIP-3009 (`authorizationState`, standard `TransferWithAuthorization` typehash) and EIP-2612.
- EIP-712 domain: `name = "Global Dollar"`, `version = "1"`, `chainId` = 4663 / 46630, `verifyingContract` = the token address above (domain separator recomputed and matched on-chain on testnet).

## Chains

| Network | v1 id | v2 id | Chain id | RPC (default) | Explorer (default) |
|---------|-------|-------|----------|---------------|--------------------|
| Robinhood Chain | `robinhood` | `eip155:4663` | 4663 | `https://rpc.mainnet.chain.robinhood.com` | `https://explorer.mainnet.chain.robinhood.com` (unconfirmed, see below) |
| Robinhood Chain Testnet | `robinhood-testnet` | `eip155:46630` | 46630 | `https://rpc.testnet.chain.robinhood.com` | `https://explorer.testnet.chain.robinhood.com` |

The mainnet explorer URL is uncertain (sources disagree between `explorer.mainnet.chain.robinhood.com` and `robinhoodchain.blockscout.com`); override it with `ROBINHOOD_EXPLORER_URL`. The dashboard's static explorer map uses the default.

## Environment variables

All optional (defaults above):

- `ROBINHOOD_RPC_URL`, `ROBINHOOD_TESTNET_RPC_URL`
- `ROBINHOOD_EXPLORER_URL`, `ROBINHOOD_TESTNET_EXPLORER_URL`

Plus the server's normal required settings (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_PATH`, ... see `packages/server/.env.example`).

## Gas requirement

The facilitator submits `transferWithAuthorization` from its own EVM wallet, so that wallet must hold **ETH on the target chain** (testnet ETH on 46630 for testing). The same EVM wallet address is used on every EVM chain. The payer needs only USDG, no gas.

## Running

```bash
pnpm install
cp packages/server/.env.example packages/server/.env   # set BETTER_AUTH_SECRET etc.
pnpm --filter @openfacilitator/server dev              # http://localhost:5002 by default
# or: docker compose up --build                        # server on :3001
```

Create a facilitator (dashboard or `POST /api/admin/facilitators`) with `supportedChains` including `4663` and/or `46630`, and generate its EVM wallet. New facilitators default to `[8453, "solana"]`, so Robinhood must be selected explicitly. If `supportedTokens` is omitted, mainnet USDG is added automatically for 4663; pass the testnet token (`defaultTokens`-style entry) explicitly for 46630.

## Expected `/supported` output

For a facilitator with chains `[4663, 46630]` (plus any others):

```json
{ "kinds": [
  { "x402Version": 1, "scheme": "exact", "network": "robinhood" },
  { "x402Version": 2, "scheme": "exact", "network": "eip155:4663" },
  { "x402Version": 1, "scheme": "exact", "network": "robinhood-testnet" },
  { "x402Version": 2, "scheme": "exact", "network": "eip155:46630" }
], "signers": { "eip155:*": ["<facilitator EVM address>"] }, "extensions": [] }
```

## Payment requirements example

```json
{ "scheme": "exact", "network": "eip155:46630", "amount": "1000",
  "asset": "0x7E955252E15c84f5768B83c41a71F9eba181802F", "payTo": "0x...",
  "extra": { "name": "Global Dollar", "version": "1" } }
```

`extra.name/version` are optional for USDG; the facilitator falls back to the registry.

## Tests

```bash
pnpm --filter @openfacilitator/core test
```

## Smoke script (manual, funded testnet key)

```bash
PAYER_PRIVATE_KEY=0x... PAY_TO=0x... FACILITATOR_SUBDOMAIN=<subdomain> \
  pnpm --filter @openfacilitator/server exec tsx ../integration-tests/scripts/robinhood-smoke.ts          # verify only
# add --settle to submit the transfer (needs facilitator-wallet gas and payer USDG)
```

Options and details are documented at the top of the script. The key is read only from `PAYER_PRIVATE_KEY` and is never printed.

## Security notes

- **Recipient binding.** For EVM (ERC-3009) payments, `verify()` rejects any authorization whose signed `to` is not the seller's `requirements.payTo` (case-insensitive address compare). `settle()` re-checks right before sending, and `executeERC3009Settlement` takes an `expectedRecipient` (passed as `payTo`) and refuses mismatches before acquiring a nonce or sending a transaction. Without this, a buyer could sign a correct-amount transfer to their own address, pass `/verify` and `/settle`, and the seller would receive nothing. Amount semantics are unchanged (`value >= required`).

## Public mode (no accounts, environment-only)

For a facilitator you operate yourself, with no sign-ups or tenants, use the built-in public endpoint. Everything
is configured through environment variables:

| Variable | Meaning |
|----------|---------|
| `FREE_FACILITATOR_EVM_KEY` | Required. Private key of the settlement wallet (pays gas, needs ETH on each served chain). |
| `FREE_FACILITATOR_EVM_CHAINS` | Comma-separated EVM chain ids to serve, e.g. `46630` or `46630,4663`. Only these are served, with their registered tokens (USDG for Robinhood). Unset keeps the legacy Base defaults. Unknown ids are ignored and logged. |
| `FREE_FACILITATOR_PUBLIC_URL` | Optional. Base URL advertised by `/free/info`. |

Routes: `GET /free/supported`, `POST /free/verify`, `POST /free/settle`, `GET /free/info`, plus `GET /health`.
`/free/supported` reports the settlement wallet derived from the key as the EVM signer. Recipient binding and the
USDG signature check apply exactly as in the tenant mode. From the parent repo, `pnpm x402:facilitator` creates the
`.env`, validates the key and starts it (`--generate-dev-key` makes a throwaway testnet key for local trials).

### Custom test token

To use your own ERC-3009 token (for example a mock USDG deployed on Robinhood Chain Testnet), register its EIP-712
signing domain with `FREE_FACILITATOR_TOKEN_DOMAINS`, a JSON array:

```
FREE_FACILITATOR_TOKEN_DOMAINS=[{"chainId":46630,"address":"0xYourToken","name":"Mock Global Dollar","version":"1"}]
```

Each entry needs `chainId` (number or numeric string), `address` (0x + 40 hex), and the token's EIP-712 `name` and
`version` exactly as the contract reports them. Entries are registered at start-up (one `[tokens] registered ...` log
line each; malformed entries are logged as warnings and skipped) and apply to `/free/*` and tenant routes alike. Once
registered, `/verify` checks the payer's `TransferWithAuthorization` signature off-chain for that token, so bad
signatures are rejected before settlement spends gas. A built-in token (real USDG) cannot be given a different domain.
Without a registration, the signature is only validated on-chain at settlement.
