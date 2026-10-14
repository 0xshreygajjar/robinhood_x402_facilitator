/**
 * Manual smoke test: Robinhood Chain Testnet USDG payment through a local facilitator.
 *
 * NOT part of the automated test suite. Run by hand with a FUNDED testnet key:
 *
 *   PAYER_PRIVATE_KEY=0x... PAY_TO=0x... FACILITATOR_SUBDOMAIN=<subdomain> \
 *     pnpm --filter @openfacilitator/server exec tsx ../integration-tests/scripts/robinhood-smoke.ts [--settle]
 *
 * Environment variables:
 *   PAYER_PRIVATE_KEY      (required) 0x-prefixed key of a wallet holding testnet USDG. Read only from
 *                          the environment; never printed or logged.
 *   PAY_TO                 (required) recipient address of the 0.001 USDG payment.
 *   FACILITATOR_SUBDOMAIN  (required) subdomain of a facilitator that has chain 46630 enabled and a
 *                          funded EVM wallet. Sent as the X-Facilitator-Subdomain dev header.
 *   FACILITATOR_URL        (optional) default http://localhost:5002 (the server's default PORT; docker compose uses 3001).
 *   AMOUNT                 (optional) base units of USDG, default 1000 (= 0.001 USDG, 6 decimals).
 *
 * By default only POST /verify is called. Pass --settle to also POST /settle, which makes the
 * facilitator wallet send a real testnet transaction (it must hold testnet ETH for gas).
 */
import { createPublicClient, http, isAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';

const CHAIN_ID = 46630;
const NETWORK = 'robinhood-testnet';
const USDG = '0x7E955252E15c84f5768B83c41a71F9eba181802F' as const;
const EXPLORER = process.env.ROBINHOOD_TESTNET_EXPLORER_URL || 'https://explorer.testnet.chain.robinhood.com';
const RPC = process.env.ROBINHOOD_TESTNET_RPC_URL || 'https://rpc.testnet.chain.robinhood.com';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}. See the header of this script.`);
    process.exit(1);
  }
  return v;
}

async function post(url: string, subdomain: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-facilitator-subdomain': subdomain },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function main() {
  const pk = required('PAYER_PRIVATE_KEY');
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error('PAYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string.');
    process.exit(1);
  }
  const payTo = required('PAY_TO');
  if (!isAddress(payTo)) {
    console.error('PAY_TO is not a valid address.');
    process.exit(1);
  }
  const subdomain = required('FACILITATOR_SUBDOMAIN');
  const base = (process.env.FACILITATOR_URL || 'http://localhost:5002').replace(/\/$/, '');
  const amount = process.env.AMOUNT || '1000';
  const doSettle = process.argv.includes('--settle');

  const account = privateKeyToAccount(pk as Hex);
  console.log(`Payer:        ${account.address}`);
  console.log(`Pay to:       ${payTo}`);
  console.log(`Amount:       ${amount} base units USDG`);
  console.log(`Facilitator:  ${base} (subdomain ${subdomain})`);

  // Read-only sanity check of the payer's USDG balance.
  try {
    const client = createPublicClient({ transport: http(RPC) });
    const bal = (await client.readContract({
      address: USDG,
      abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [account.address],
    })) as bigint;
    console.log(`Payer USDG balance: ${bal} base units`);
    if (bal < BigInt(amount)) console.warn('WARNING: payer balance is below the payment amount; settlement will fail.');
  } catch (e) {
    console.warn(`Could not read payer balance: ${e instanceof Error ? e.message : String(e)}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address,
    to: payTo,
    value: amount,
    validAfter: now - 60,
    validBefore: now + 600,
    nonce: `0x${randomBytes(32).toString('hex')}` as Hex,
  };

  const signature = await account.signTypedData({
    domain: { name: 'Global Dollar', version: '1', chainId: CHAIN_ID, verifyingContract: USDG },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: authorization.from,
      to: authorization.to as Hex,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  const paymentPayload = { x402Version: 1, scheme: 'exact', network: NETWORK, payload: { signature, authorization } };
  const paymentRequirements = {
    scheme: 'exact',
    network: NETWORK,
    maxAmountRequired: amount,
    resource: 'https://example.com/robinhood-smoke',
    description: 'Robinhood testnet USDG smoke test',
    mimeType: 'application/json',
    payTo,
    maxTimeoutSeconds: 300,
    asset: USDG,
    extra: { name: 'Global Dollar', version: '1' },
  };
  const body = { x402Version: 1, paymentPayload, paymentRequirements };

  const verify = await post(`${base}/verify`, subdomain, body);
  console.log('\n/verify ->', verify.status, JSON.stringify(verify.json));
  if (!(verify.json as { isValid?: boolean })?.isValid) {
    console.error('Verification failed; not settling.');
    process.exit(2);
  }

  if (!doSettle) {
    console.log('\nVerify OK. Re-run with --settle to submit the transfer on-chain (facilitator wallet needs testnet ETH).');
    return;
  }

  const settle = await post(`${base}/settle`, subdomain, body);
  console.log('\n/settle ->', settle.status, JSON.stringify(settle.json));
  const tx = (settle.json as { transaction?: string })?.transaction;
  if (tx) console.log(`\nExplorer: ${EXPLORER}/tx/${tx}`);
  else process.exit(3);
}

main().catch((e) => {
  console.error('Smoke test error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
