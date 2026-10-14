import { recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { knownTokens } from './tokens.js';
import type { ERC3009Authorization } from './erc3009.js';

/**
 * EIP-712 domain parameters for an ERC-3009 token
 */
export interface Eip712TokenDomain {
  name: string;
  version: string;
}

/**
 * Per-token EIP-712 domain overrides, keyed by `${chainId}:${lowercased token address}`.
 * Used when payment requirements do not carry `extra.name` / `extra.version`.
 * Entries here are also the tokens for which the facilitator checks the
 * authorization signature during /verify.
 */
export const tokenDomainOverrides: Record<string, Eip712TokenDomain> = {
  // USDG (Global Dollar) on Robinhood Chain Mainnet / Testnet
  [`4663:${knownTokens.USDG[4663].toLowerCase()}`]: { name: 'Global Dollar', version: '1' },
  [`46630:${knownTokens.USDG[46630].toLowerCase()}`]: { name: 'Global Dollar', version: '1' },
};

const builtInTokenDomainKeys = new Set(Object.keys(tokenDomainOverrides));

/**
 * Register the EIP-712 domain of an extra ERC-3009 token at runtime (e.g. from environment
 * configuration). Registered tokens get the same off-chain signature pre-verification as built-in ones.
 * A built-in entry can only be re-registered with an identical domain; a different one throws.
 */
export function registerTokenDomainOverride(chainId: number, address: string, domain: Eip712TokenDomain): void {
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid chainId: ${String(chainId)}`);
  }
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`Invalid token address: ${String(address)}`);
  }
  const name = typeof domain?.name === 'string' ? domain.name.trim() : '';
  const version = typeof domain?.version === 'string' ? domain.version.trim() : '';
  if (!name) throw new Error('EIP-712 domain name must be a non-empty string');
  if (!version) throw new Error('EIP-712 domain version must be a non-empty string');

  const key = `${chainId}:${address.toLowerCase()}`;
  const existing = tokenDomainOverrides[key];
  if (builtInTokenDomainKeys.has(key) && existing && (existing.name !== name || existing.version !== version)) {
    throw new Error(`Refusing to override built-in token domain for ${key}`);
  }
  tokenDomainOverrides[key] = { name, version };
}

/**
 * Whether a registry override exists for this token
 */
export function hasTokenDomainOverride(chainId: number, token: string): boolean {
  return `${chainId}:${token.toLowerCase()}` in tokenDomainOverrides;
}

/**
 * Resolve the EIP-712 domain name/version for a token.
 * Client-supplied `extra.name` / `extra.version` win; otherwise the registry override is used.
 */
export function resolveEip712Domain(
  chainId: number,
  token: string,
  extra?: Record<string, unknown>
): Eip712TokenDomain | undefined {
  const override = tokenDomainOverrides[`${chainId}:${token.toLowerCase()}`];
  const name = typeof extra?.name === 'string' && extra.name ? extra.name : override?.name;
  const version = typeof extra?.version === 'string' && extra.version ? extra.version : override?.version;
  if (!name || !version) return undefined;
  return { name, version };
}

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/**
 * Build the EIP-712 typed data for an ERC-3009 TransferWithAuthorization
 */
export function buildTransferWithAuthorizationTypedData(params: {
  chainId: number;
  token: Address;
  domain: Eip712TokenDomain;
  authorization: ERC3009Authorization;
}) {
  const { chainId, token, domain, authorization } = params;
  return {
    domain: {
      name: domain.name,
      version: domain.version,
      chainId,
      verifyingContract: token,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization' as const,
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  };
}

/**
 * Recover the signer of an ERC-3009 authorization and compare it to `authorization.from`.
 * Only EOA (ECDSA) signatures are supported; returns false on any malformed signature.
 */
export async function verifyTransferWithAuthorizationSignature(params: {
  chainId: number;
  token: Address;
  domain: Eip712TokenDomain;
  authorization: ERC3009Authorization;
  signature: Hex;
}): Promise<boolean> {
  try {
    const typed = buildTransferWithAuthorizationTypedData(params);
    const recovered = await recoverTypedDataAddress({ ...typed, signature: params.signature });
    return recovered.toLowerCase() === params.authorization.from.toLowerCase();
  } catch {
    return false;
  }
}
