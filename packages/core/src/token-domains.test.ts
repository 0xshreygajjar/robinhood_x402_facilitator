import { describe, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import {
  buildTransferWithAuthorizationTypedData,
  createFacilitator,
  hasTokenDomainOverride,
  knownTokens,
  registerTokenDomainOverride,
  resolveEip712Domain,
  type FacilitatorConfig,
  type PaymentRequirements,
} from './index.js';

const MOCK_TOKEN = '0x1111111111111111111111111111111111111111' as const;
const MOCK_DOMAIN = { name: 'Mock Global Dollar', version: '1' };

describe('registerTokenDomainOverride', () => {
  it('registers a token so the override lookup and domain resolution see it', () => {
    const addr = '0x2222222222222222222222222222222222222222';
    expect(hasTokenDomainOverride(46630, addr)).toBe(false);
    registerTokenDomainOverride(46630, addr.toUpperCase().replace('0X', '0x'), MOCK_DOMAIN);
    expect(hasTokenDomainOverride(46630, addr)).toBe(true);
    expect(resolveEip712Domain(46630, addr)).toEqual(MOCK_DOMAIN);
    expect(hasTokenDomainOverride(4663, addr)).toBe(false);
  });

  it('rejects invalid addresses, names and versions', () => {
    expect(() => registerTokenDomainOverride(46630, 'nope', MOCK_DOMAIN)).toThrow(/address/i);
    expect(() => registerTokenDomainOverride(46630, '0x1234', MOCK_DOMAIN)).toThrow(/address/i);
    expect(() => registerTokenDomainOverride(46630, MOCK_TOKEN, { name: ' ', version: '1' })).toThrow(/name/i);
    expect(() => registerTokenDomainOverride(46630, MOCK_TOKEN, { name: 'X', version: '' })).toThrow(/version/i);
    expect(() => registerTokenDomainOverride(0, MOCK_TOKEN, MOCK_DOMAIN)).toThrow(/chain/i);
  });

  it('does not override a built-in USDG entry with a different domain', () => {
    expect(() =>
      registerTokenDomainOverride(46630, knownTokens.USDG[46630], { name: 'Evil', version: '9' })
    ).toThrow(/built-in/i);
    expect(resolveEip712Domain(46630, knownTokens.USDG[46630])).toEqual({ name: 'Global Dollar', version: '1' });
  });

  it('allows re-registering a built-in entry with the identical domain', () => {
    expect(() =>
      registerTokenDomainOverride(46630, knownTokens.USDG[46630], { name: 'Global Dollar', version: '1' })
    ).not.toThrow();
  });
});

describe('Facilitator#verify with a registered custom token', () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const payTo = '0x00000000000000000000000000000000000000AA' as const;
  const token = '0x3333333333333333333333333333333333333333' as const;
  registerTokenDomainOverride(46630, token, MOCK_DOMAIN);

  const config: FacilitatorConfig = {
    id: 'f1',
    name: 'Test',
    subdomain: 'test',
    ownerAddress: '0x0000000000000000000000000000000000000001',
    supportedChains: [46630],
    supportedTokens: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  function setup() {
    const facilitator = createFacilitator(config);
    const client = { readContract: vi.fn().mockResolvedValue(false), getBalance: vi.fn().mockResolvedValue(10n ** 18n) };
    (facilitator as unknown as { clients: Map<number, unknown> }).clients.set(46630, client);
    return facilitator;
  }

  async function signed(domain = MOCK_DOMAIN) {
    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from: account.address,
      to: payTo,
      value: '1000',
      validAfter: now - 60,
      validBefore: now + 600,
      nonce: ('0x' + 'cd'.repeat(32)) as Hex,
    };
    const signature = await account.signTypedData(
      buildTransferWithAuthorizationTypedData({ chainId: 46630, token, domain, authorization })
    );
    return { authorization, signature };
  }

  const encode = (authorization: unknown, signature: string) =>
    Buffer.from(
      JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'robinhood-testnet', payload: { authorization, signature } })
    ).toString('base64');

  const requirements = {
    scheme: 'exact',
    network: 'robinhood-testnet',
    maxAmountRequired: '1000',
    asset: token,
    payTo,
    resource: 'https://example.com/r',
    description: 'test',
    mimeType: 'application/json',
    maxTimeoutSeconds: 300,
  } as PaymentRequirements;

  it('accepts a correctly signed payment', async () => {
    const { authorization, signature } = await signed();
    const res = await setup().verify(encode(authorization, signature), requirements);
    expect(res).toEqual({ isValid: true, payer: account.address });
  });

  it('rejects a tampered signature', async () => {
    const { authorization, signature } = await signed();
    const flipped = signature.slice(0, 10) + (signature[10] === '0' ? '1' : '0') + signature.slice(11);
    const res = await setup().verify(encode(authorization, flipped), requirements);
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe('Invalid authorization signature');
  });

  it('rejects a signature made under the wrong domain name', async () => {
    const { authorization, signature } = await signed({ name: 'Global Dollar', version: '1' });
    const res = await setup().verify(encode(authorization, signature), requirements);
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe('Invalid authorization signature');
  });
});
