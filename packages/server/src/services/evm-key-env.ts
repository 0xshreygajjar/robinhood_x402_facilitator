export interface NormalizedEvmKey {
  /** 0x-prefixed 32-byte private key, ready for viem. Undefined when the value is unusable. */
  key?: `0x${string}`;
  /** Why the value was rejected. Never contains the value itself. */
  problem?: string;
}

/**
 * Normalizes FREE_FACILITATOR_EVM_KEY. Wallets and tools often export a private key without the 0x prefix, but
 * viem requires it, so accept either form (and surrounding whitespace or quotes). The value is never echoed.
 */
export function normalizeEvmPrivateKey(value: string | undefined): NormalizedEvmKey {
  if (value === undefined || value.trim() === '') return { problem: 'not set' };
  let v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1).trim();
  const hex = /^0x/i.test(v) ? v.slice(2) : v;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    return { problem: 'must be a 32-byte hex private key (64 hex characters, with or without a 0x prefix)' };
  }
  return { key: `0x${hex}` };
}
