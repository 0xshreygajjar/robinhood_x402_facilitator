import { describe, expect, it, vi } from 'vitest';
import { hasTokenDomainOverride, resolveEip712Domain } from '@openfacilitator/core';
import { parseTokenDomainsEnv, registerTokenDomainsFromEnv } from './token-domains-env.js';

const A = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const B = '0x4444444444444444444444444444444444444444';

describe('parseTokenDomainsEnv', () => {
  it('returns nothing for unset or blank values', () => {
    for (const v of [undefined, '', '   ']) {
      expect(parseTokenDomainsEnv(v)).toEqual({ entries: [], errors: [] });
    }
  });

  it('parses a valid entry', () => {
    const r = parseTokenDomainsEnv(JSON.stringify([{ chainId: 46630, address: A, name: 'Mock Global Dollar', version: '1' }]));
    expect(r.errors).toEqual([]);
    expect(r.entries).toEqual([{ chainId: 46630, address: A, name: 'Mock Global Dollar', version: '1' }]);
  });

  it('parses several entries and accepts a numeric-string chainId', () => {
    const r = parseTokenDomainsEnv(
      JSON.stringify([
        { chainId: '46630', address: A, name: 'One', version: '1' },
        { chainId: 4663, address: B, name: 'Two', version: '2' },
      ])
    );
    expect(r.errors).toEqual([]);
    expect(r.entries.map((e) => e.chainId)).toEqual([46630, 4663]);
  });

  it('reports malformed JSON without throwing or echoing the value', () => {
    const r = parseTokenDomainsEnv('{not json secret-value');
    expect(r.entries).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/not valid JSON/);
    expect(r.errors[0]).not.toContain('secret-value');
  });

  it('rejects non-arrays', () => {
    const r = parseTokenDomainsEnv('{"chainId":46630}');
    expect(r.entries).toEqual([]);
    expect(r.errors[0]).toMatch(/JSON array/);
  });

  it('reports invalid entries and keeps the valid ones', () => {
    const r = parseTokenDomainsEnv(
      JSON.stringify([
        { chainId: 46630, address: A, name: 'Ok', version: '1' },
        { chainId: 46630, address: A },
        { chainId: 46630, address: '0x12', name: 'Bad', version: '1' },
        { chainId: 'abc', address: A, name: 'Bad', version: '1' },
        'oops',
        null,
      ])
    );
    expect(r.entries).toHaveLength(1);
    expect(r.errors).toHaveLength(5);
    expect(r.errors[0]).toMatch(/entry 2/);
  });

  it('flags duplicate chain/address pairs and keeps the first', () => {
    const r = parseTokenDomainsEnv(
      JSON.stringify([
        { chainId: 46630, address: A, name: 'First', version: '1' },
        { chainId: 46630, address: A.toLowerCase(), name: 'Second', version: '1' },
      ])
    );
    expect(r.entries.map((e) => e.name)).toEqual(['First']);
    expect(r.errors[0]).toMatch(/duplicate/i);
  });
});

describe('registerTokenDomainsFromEnv', () => {
  it('registers entries into core and logs one line per token', () => {
    const addr = '0x5555555555555555555555555555555555555555';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = registerTokenDomainsFromEnv({
      FREE_FACILITATOR_TOKEN_DOMAINS: JSON.stringify([{ chainId: 46630, address: addr, name: 'Mock Global Dollar', version: '1' }]),
    });
    expect(result.registered).toBe(1);
    expect(hasTokenDomainOverride(46630, addr)).toBe(true);
    expect(resolveEip712Domain(46630, addr)).toEqual({ name: 'Mock Global Dollar', version: '1' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^\[tokens\] registered EIP-712 domain for 46630:0x5555….* \(Mock Global Dollar v1\)$/);
    expect(warn).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
  });

  it('warns on errors and on built-in conflicts without throwing', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const usdg = '0x7E955252E15c84f5768B83c41a71F9eba181802F';
    const result = registerTokenDomainsFromEnv({
      FREE_FACILITATOR_TOKEN_DOMAINS: JSON.stringify([
        { chainId: 46630, address: usdg, name: 'Evil', version: '9' },
        { chainId: 46630, address: 'bad', name: 'X', version: '1' },
      ]),
    });
    expect(result.registered).toBe(0);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(resolveEip712Domain(46630, usdg)?.name).toBe('Global Dollar');
    log.mockRestore();
    warn.mockRestore();
  });

  it('is a no-op when the variable is unset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(registerTokenDomainsFromEnv({})).toEqual({ registered: 0, errors: [] });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
