import { describe, expect, it } from 'vitest';
import { resolveEvmChainSelection } from './evm-chains-env.js';

const USDG_TESTNET = '0x7E955252E15c84f5768B83c41a71F9eba181802F';
const USDG_MAINNET = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

describe('resolveEvmChainSelection', () => {
  it('returns null when unset or blank so legacy defaults stay in place', () => {
    expect(resolveEvmChainSelection(undefined)).toBeNull();
    expect(resolveEvmChainSelection('')).toBeNull();
    expect(resolveEvmChainSelection('   ')).toBeNull();
  });

  it('selects Robinhood Chain Testnet with testnet USDG only', () => {
    const sel = resolveEvmChainSelection('46630');
    expect(sel?.chains).toEqual([46630]);
    expect(sel?.ignored).toEqual([]);
    expect(sel?.tokens.map((t) => t.address.toLowerCase())).toEqual([USDG_TESTNET.toLowerCase()]);
    expect(sel?.tokens[0].symbol).toBe('USDG');
    expect(sel?.tokens[0].decimals).toBe(6);
  });

  it('selects Robinhood Chain mainnet with mainnet USDG', () => {
    const sel = resolveEvmChainSelection('4663');
    expect(sel?.chains).toEqual([4663]);
    expect(sel?.tokens.map((t) => t.address.toLowerCase())).toEqual([USDG_MAINNET.toLowerCase()]);
  });

  it('accepts several chains, spaces, and duplicates', () => {
    const sel = resolveEvmChainSelection(' 46630 , 4663,46630 ');
    expect(sel?.chains).toEqual([46630, 4663]);
    expect(sel?.tokens).toHaveLength(2);
  });

  it('ignores unknown ids, non-numbers and non-EVM entries instead of serving them', () => {
    const sel = resolveEvmChainSelection('46630,9999999,abc,solana,-1,1.5');
    expect(sel?.chains).toEqual([46630]);
    expect(sel?.ignored).toEqual(['9999999', 'abc', 'solana', '-1', '1.5']);
  });

  it('can end up with no usable chains and says so', () => {
    const sel = resolveEvmChainSelection('9999999');
    expect(sel?.chains).toEqual([]);
    expect(sel?.tokens).toEqual([]);
    expect(sel?.ignored).toEqual(['9999999']);
  });
});
