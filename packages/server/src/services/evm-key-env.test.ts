import { describe, expect, it } from 'vitest';
import { normalizeEvmPrivateKey } from './evm-key-env.js';

const HEX = 'ab'.repeat(32);

describe('normalizeEvmPrivateKey', () => {
  it('accepts a 0x-prefixed key unchanged', () => {
    expect(normalizeEvmPrivateKey(`0x${HEX}`)).toEqual({ key: `0x${HEX}` });
  });

  it('adds the missing 0x prefix', () => {
    expect(normalizeEvmPrivateKey(HEX)).toEqual({ key: `0x${HEX}` });
  });

  it('accepts an uppercase 0X prefix, whitespace and surrounding quotes', () => {
    expect(normalizeEvmPrivateKey(`  0X${HEX}  `).key).toBe(`0x${HEX}`);
    expect(normalizeEvmPrivateKey(`"${HEX}"`).key).toBe(`0x${HEX}`);
    expect(normalizeEvmPrivateKey(`'0x${HEX}'`).key).toBe(`0x${HEX}`);
  });

  it('rejects unset, blank, short, long and non-hex values without echoing them', () => {
    for (const bad of [undefined, '', '   ', 'abc', HEX.slice(0, 62), HEX + 'ab', `0x${'zz'.repeat(32)}`]) {
      const r = normalizeEvmPrivateKey(bad);
      expect(r.key).toBeUndefined();
      expect(r.problem).toBeTruthy();
      if (bad && bad.trim()) expect(r.problem).not.toContain(bad.trim());
    }
  });
});
