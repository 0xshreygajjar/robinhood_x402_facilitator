import { describe, expect, it, vi } from 'vitest';
import { executeERC3009Settlement } from './erc3009.js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import {
  caip2ToNetwork,
  chainIdToNetwork,
  createFacilitator,
  getCaip2FromNetwork,
  getChainConfig,
  getChainIdFromNetwork,
  getNetworkFromCaip2,
  getNetworkFromChainId,
  getTokenConfig,
  getTokensForChain,
  buildTransferWithAuthorizationTypedData,
  isChainSupported,
  isTokenSupported,
  knownTokens,
  productionChains,
  resolveEip712Domain,
  testChains,
  defaultTokens,
  testTokens,
  type FacilitatorConfig,
  type PaymentRequirements,
} from './index.js';

// Spy on settlement so tests can prove no transaction path is reached.
vi.mock('./erc3009.js', async () => {
  const actual = await vi.importActual<typeof import('./erc3009.js')>('./erc3009.js');
  return {
    ...actual,
    executeERC3009Settlement: vi.fn(async () => ({ success: true, transactionHash: '0xabc' })),
  };
});

const USDG_TESTNET = '0x7E955252E15c84f5768B83c41a71F9eba181802F';
const USDG_MAINNET = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const DOMAIN = { name: 'Global Dollar', version: '1' };

describe('Robinhood chain registry', () => {
  it('resolves both chains by chain id and network name', () => {
    expect(getChainConfig(4663)?.network).toBe('robinhood');
    expect(getChainConfig('robinhood')?.chainId).toBe(4663);
    expect(getChainConfig(46630)?.network).toBe('robinhood-testnet');
    expect(getChainConfig('robinhood-testnet')?.chainId).toBe(46630);
    expect(getChainConfig(4663)?.isEVM).toBe(true);
    expect(getChainConfig(4663)?.rpcUrl).toBe('https://rpc.mainnet.chain.robinhood.com');
    expect(getChainConfig(46630)?.rpcUrl).toBe('https://rpc.testnet.chain.robinhood.com');
    expect(getChainConfig(46630)?.blockExplorerUrl).toBe('https://explorer.testnet.chain.robinhood.com');
    expect(isChainSupported(4663)).toBe(true);
    expect(isChainSupported(46630)).toBe(true);
  });

  it('maps v1 names and CAIP-2 ids in both directions', () => {
    expect(getChainIdFromNetwork('robinhood')).toBe(4663);
    expect(getChainIdFromNetwork('robinhood-testnet')).toBe(46630);
    expect(getChainIdFromNetwork('eip155:4663')).toBe(4663);
    expect(getChainIdFromNetwork('eip155:46630')).toBe(46630);
    expect(getNetworkFromChainId(4663)).toBe('robinhood');
    expect(getNetworkFromChainId(46630)).toBe('robinhood-testnet');
    expect(getCaip2FromNetwork('robinhood')).toBe('eip155:4663');
    expect(getCaip2FromNetwork('robinhood-testnet')).toBe('eip155:46630');
    expect(getNetworkFromCaip2('eip155:4663')).toBe('robinhood');
    expect(getNetworkFromCaip2('eip155:46630')).toBe('robinhood-testnet');
    expect(chainIdToNetwork[4663]).toBe('robinhood');
    expect(caip2ToNetwork['eip155:46630']).toBe('robinhood-testnet');
    expect(productionChains).toContain(4663);
    expect(testChains).toContain(46630);
  });
});

describe('USDG token registry', () => {
  it('has known addresses and registry entries', () => {
    expect(knownTokens.USDG[4663]).toBe(USDG_MAINNET);
    expect(knownTokens.USDG[46630]).toBe(USDG_TESTNET);
    expect(defaultTokens).toContainEqual({ address: USDG_MAINNET, symbol: 'USDG', decimals: 6, chainId: 4663 });
    expect(testTokens).toContainEqual({ address: USDG_TESTNET, symbol: 'USDG', decimals: 6, chainId: 46630 });
    expect(getTokenConfig(46630, USDG_TESTNET.toLowerCase())?.symbol).toBe('USDG');
    expect(getTokenConfig(4663, USDG_MAINNET)?.decimals).toBe(6);
    expect(getTokensForChain(46630)).toHaveLength(1);
    expect(isTokenSupported(4663, USDG_MAINNET)).toBe(true);
    expect(isTokenSupported(4663, USDG_TESTNET)).toBe(false);
  });

  it('resolves the USDG EIP-712 domain with client override precedence', () => {
    expect(resolveEip712Domain(46630, USDG_TESTNET)).toEqual(DOMAIN);
    expect(resolveEip712Domain(4663, USDG_MAINNET.toLowerCase())).toEqual(DOMAIN);
    expect(resolveEip712Domain(46630, USDG_TESTNET, { name: 'Other', version: '9' })).toEqual({
      name: 'Other',
      version: '9',
    });
    expect(resolveEip712Domain(8453, knownTokens.USDC[8453])).toBeUndefined();
  });
});

function makeConfig(chains: FacilitatorConfig['supportedChains']): FacilitatorConfig {
  return {
    id: 'f1',
    name: 'Test',
    subdomain: 'test',
    ownerAddress: '0x0000000000000000000000000000000000000001',
    supportedChains: chains,
    supportedTokens: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe('Facilitator#getSupported', () => {
  it('lists Robinhood in v1 and v2 formats with scheme exact', () => {
    const { kinds } = createFacilitator(makeConfig([4663, 46630])).getSupported();
    const has = (v: number, n: string) => kinds.some((k) => k.x402Version === v && k.network === n && k.scheme === 'exact');
    expect(has(1, 'robinhood')).toBe(true);
    expect(has(1, 'robinhood-testnet')).toBe(true);
    expect(has(2, 'eip155:4663')).toBe(true);
    expect(has(2, 'eip155:46630')).toBe(true);
  });
});

describe('Facilitator#verify (USDG on Robinhood testnet)', () => {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const payTo = '0x00000000000000000000000000000000000000AA' as const;

  function setup() {
    const facilitator = createFacilitator(makeConfig([46630]));
    // Mocked public client: no network access during tests.
    const client = {
      readContract: vi.fn().mockResolvedValue(false),
      getBalance: vi.fn().mockResolvedValue(10n ** 18n),
    };
    (facilitator as unknown as { clients: Map<number, unknown> }).clients.set(46630, client);
    return { facilitator, client };
  }

  async function signed(overrides: { validBefore?: number } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from: account.address,
      to: payTo,
      value: '1000', // 0.001 USDG
      validAfter: now - 60,
      validBefore: overrides.validBefore ?? now + 600,
      nonce: ('0x' + 'ab'.repeat(32)) as Hex,
    };
    const typed = buildTransferWithAuthorizationTypedData({
      chainId: 46630,
      token: USDG_TESTNET,
      domain: DOMAIN,
      authorization,
    });
    const signature = await account.signTypedData(typed);
    return { authorization, signature };
  }

  function encode(authorization: unknown, signature: string) {
    return Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'robinhood-testnet', payload: { authorization, signature } })).toString('base64');
  }

  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: 'robinhood-testnet',
    maxAmountRequired: '1000',
    asset: USDG_TESTNET,
    payTo,
    resource: 'https://example.com/r',
    description: 'test',
    mimeType: 'application/json',
    maxTimeoutSeconds: 300,
  } as PaymentRequirements;

  it('accepts a valid signed authorization (v1 and CAIP-2 network)', async () => {
    const { facilitator } = setup();
    const { authorization, signature } = await signed();
    const res = await facilitator.verify(encode(authorization, signature), requirements);
    expect(res).toEqual({ isValid: true, payer: account.address });
    const v2 = await facilitator.verify(encode(authorization, signature), { ...requirements, network: 'eip155:46630' });
    expect(v2.isValid).toBe(true);
  });

  it('accepts a client-supplied extra.name/version', async () => {
    const { facilitator } = setup();
    const { authorization, signature } = await signed();
    const res = await facilitator.verify(encode(authorization, signature), {
      ...requirements,
      extra: { name: 'Global Dollar', version: '1' },
    });
    expect(res.isValid).toBe(true);
  });

  it('rejects a tampered signature', async () => {
    const { facilitator } = setup();
    const { authorization, signature } = await signed();
    const flipped = signature.slice(0, 10) + (signature[10] === '0' ? '1' : '0') + signature.slice(11);
    const res = await facilitator.verify(encode(authorization, flipped), requirements);
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe('Invalid authorization signature');
  });

  it('rejects a signature over different authorization data', async () => {
    const { facilitator } = setup();
    const { authorization, signature } = await signed();
    const res = await facilitator.verify(encode({ ...authorization, value: '5000' }, signature), {
      ...requirements,
      maxAmountRequired: '1000',
    });
    expect(res.isValid).toBe(false);
  });

  it('rejects an expired validBefore', async () => {
    const { facilitator } = setup();
    const { authorization, signature } = await signed({ validBefore: Math.floor(Date.now() / 1000) - 10 });
    const res = await facilitator.verify(encode(authorization, signature), requirements);
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe('Payment has expired');
  });

  it('rejects an underpayment', async () => {
    const { facilitator } = setup();
    const { authorization, signature } = await signed();
    const res = await facilitator.verify(encode(authorization, signature), { ...requirements, maxAmountRequired: '2000' });
    expect(res.isValid).toBe(false);
  });
});

describe('Recipient binding (authorization.to must equal payTo)', () => {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const payTo = '0x00000000000000000000000000000000000000AA' as const;
  const attacker = '0x00000000000000000000000000000000000000bb' as const;
  const settleMock = vi.mocked(executeERC3009Settlement);

  const requirements = {
    scheme: 'exact',
    network: 'robinhood-testnet',
    maxAmountRequired: '1000',
    asset: USDG_TESTNET,
    payTo,
    resource: 'https://example.com/r',
    description: 'test',
    mimeType: 'application/json',
    maxTimeoutSeconds: 300,
  } as PaymentRequirements;

  async function build(to: string, value = '1000') {
    const facilitator = createFacilitator(makeConfig([46630]));
    (facilitator as unknown as { clients: Map<number, unknown> }).clients.set(46630, {});
    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from: account.address,
      to: to as `0x${string}`,
      value,
      validAfter: now - 60,
      validBefore: now + 600,
      nonce: ('0x' + 'cd'.repeat(32)) as Hex,
    };
    const signature = await account.signTypedData(
      buildTransferWithAuthorizationTypedData({ chainId: 46630, token: USDG_TESTNET, domain: DOMAIN, authorization })
    );
    const encoded = Buffer.from(
      JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'robinhood-testnet', payload: { authorization, signature } })
    ).toString('base64');
    return { facilitator, encoded };
  }

  it('verify rejects a validly signed authorization paying someone else', async () => {
    const { facilitator, encoded } = await build(attacker);
    const res = await facilitator.verify(encoded, requirements);
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toMatch(/recipient/i);
  });

  it('verify rejects a self-payment to the payer', async () => {
    const { facilitator, encoded } = await build(account.address);
    expect((await facilitator.verify(encoded, requirements)).isValid).toBe(false);
  });

  it('verify matches addresses case-insensitively', async () => {
    const { facilitator, encoded } = await build(payTo.toLowerCase());
    expect((await facilitator.verify(encoded, requirements)).isValid).toBe(true);
    const mixed = await build(payTo);
    expect((await mixed.facilitator.verify(mixed.encoded, { ...requirements, payTo: payTo.toLowerCase() })).isValid).toBe(true);
  });

  it('settle with a wrong recipient fails and sends no transaction, even if verify is bypassed', async () => {
    settleMock.mockClear();
    const { facilitator, encoded } = await build(attacker);
    const viaVerify = await facilitator.settle(encoded, requirements, generatePrivateKey());
    expect(viaVerify.success).toBe(false);
    expect(settleMock).not.toHaveBeenCalled();

    vi.spyOn(facilitator, 'verify').mockResolvedValue({ isValid: true, payer: account.address });
    const bypassed = await facilitator.settle(encoded, requirements, generatePrivateKey());
    expect(bypassed.success).toBe(false);
    expect(bypassed.errorReason).toMatch(/recipient/i);
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('settle with the correct recipient passes expectedRecipient and succeeds', async () => {
    settleMock.mockClear();
    const { facilitator, encoded } = await build(payTo);
    const res = await facilitator.settle(encoded, requirements, generatePrivateKey());
    expect(res.success).toBe(true);
    expect(settleMock).toHaveBeenCalledTimes(1);
    expect(settleMock.mock.calls[0][0].expectedRecipient).toBe(payTo);
  });

  it('verify still rejects an underpayment to the right recipient', async () => {
    const { facilitator, encoded } = await build(payTo, '999');
    const res = await facilitator.verify(encoded, requirements);
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toMatch(/less than required/);
  });

  it('executeERC3009Settlement refuses a mismatched recipient before any chain access', async () => {
    const actual = await vi.importActual<typeof import('./erc3009.js')>('./erc3009.js');
    const res = await actual.executeERC3009Settlement({
      chainId: 46630,
      tokenAddress: USDG_TESTNET,
      authorization: {
        from: account.address,
        to: attacker,
        value: '1000',
        validAfter: 0,
        validBefore: 9999999999,
        nonce: ('0x' + 'ef'.repeat(32)) as Hex,
      },
      signature: '0x' as Hex,
      facilitatorPrivateKey: generatePrivateKey(),
      expectedRecipient: payTo,
    });
    expect(res.success).toBe(false);
    expect(res.errorMessage).toMatch(/recipient/i);
  });
});
