import { registerTokenDomainOverride } from '@openfacilitator/core';

/**
 * FREE_FACILITATOR_TOKEN_DOMAINS: JSON array registering extra ERC-3009 tokens' EIP-712 signing domains, e.g.
 *   [{"chainId":46630,"address":"0x...","name":"Mock Global Dollar","version":"1"}]
 * Registered tokens get off-chain authorization-signature pre-verification in /verify.
 */
export interface TokenDomainEntry {
  chainId: number;
  address: string;
  name: string;
  version: string;
}

export interface TokenDomainsParseResult {
  entries: TokenDomainEntry[];
  errors: string[];
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function parseTokenDomainsEnv(value: string | undefined): TokenDomainsParseResult {
  const entries: TokenDomainEntry[] = [];
  const errors: string[] = [];
  if (value === undefined || value.trim() === '') return { entries, errors };

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Deliberately do not echo the raw value.
    return { entries, errors: ['FREE_FACILITATOR_TOKEN_DOMAINS is not valid JSON'] };
  }
  if (!Array.isArray(parsed)) {
    return { entries, errors: ['FREE_FACILITATOR_TOKEN_DOMAINS must be a JSON array of {chainId,address,name,version}'] };
  }

  const seen = new Set<string>();
  parsed.forEach((raw, i) => {
    const label = `FREE_FACILITATOR_TOKEN_DOMAINS entry ${i + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${label}: must be an object`);
      return;
    }
    const { chainId: rawChain, address, name, version } = raw as Record<string, unknown>;
    const chainId =
      typeof rawChain === 'number' ? rawChain : typeof rawChain === 'string' && /^\d+$/.test(rawChain.trim()) ? Number(rawChain.trim()) : NaN;
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      errors.push(`${label}: chainId must be a positive integer`);
      return;
    }
    if (typeof address !== 'string' || !ADDRESS_RE.test(address)) {
      errors.push(`${label}: address must be a 0x-prefixed 40-hex-character address`);
      return;
    }
    if (typeof name !== 'string' || !name.trim()) {
      errors.push(`${label}: name must be a non-empty string`);
      return;
    }
    if (typeof version !== 'string' || !version.trim()) {
      errors.push(`${label}: version must be a non-empty string`);
      return;
    }
    const key = `${chainId}:${address.toLowerCase()}`;
    if (seen.has(key)) {
      errors.push(`${label}: duplicate of an earlier entry for ${key}; ignoring it`);
      return;
    }
    seen.add(key);
    entries.push({ chainId, address, name: name.trim(), version: version.trim() });
  });

  return { entries, errors };
}

/**
 * Register every valid FREE_FACILITATOR_TOKEN_DOMAINS entry with core. Never throws.
 */
export function registerTokenDomainsFromEnv(
  env: Record<string, string | undefined> = process.env
): { registered: number; errors: string[] } {
  const { entries, errors } = parseTokenDomainsEnv(env.FREE_FACILITATOR_TOKEN_DOMAINS);
  const allErrors = [...errors];
  let registered = 0;
  for (const e of entries) {
    try {
      registerTokenDomainOverride(e.chainId, e.address, { name: e.name, version: e.version });
      registered++;
      console.log(`[tokens] registered EIP-712 domain for ${e.chainId}:${e.address.slice(0, 6)}… (${e.name} v${e.version})`);
    } catch (err) {
      allErrors.push(`${e.chainId}:${e.address.slice(0, 6)}…: ${err instanceof Error ? err.message : 'registration failed'}`);
    }
  }
  for (const msg of allErrors) console.warn(`[tokens] ${msg}`);
  return { registered, errors: allErrors };
}
