import { allTokens, defaultChains, type TokenConfig } from '@openfacilitator/core';

export interface EvmChainSelection {
  /** EVM chain ids to serve, in the order given. */
  chains: number[];
  /** Tokens registered for those chains (for example USDG on Robinhood Chain). */
  tokens: TokenConfig[];
  /** Entries that were not usable (unknown chain id, not EVM, or no registered token). */
  ignored: string[];
}

/**
 * Parses FREE_FACILITATOR_EVM_CHAINS, a comma-separated list of EVM chain ids, for example
 * "46630" (Robinhood Chain Testnet), "4663" (Robinhood Chain) or "46630,4663".
 *
 * Returns null when the variable is unset or blank so callers keep the legacy defaults (Base).
 * Only chains that exist in the registry and have at least one registered token are accepted;
 * anything else is reported in `ignored` instead of silently serving an unusable chain.
 */
export function resolveEvmChainSelection(value: string | undefined): EvmChainSelection | null {
  if (!value || !value.trim()) return null;

  const chains: number[] = [];
  const tokens: TokenConfig[] = [];
  const ignored: string[] = [];

  for (const raw of value.split(',').map((part) => part.trim()).filter(Boolean)) {
    const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
    const chain = Number.isInteger(id) ? defaultChains[String(id)] : undefined;
    const chainTokens = allTokens.filter((token) => token.chainId === id);

    if (!chain || !chain.isEVM || chainTokens.length === 0) {
      ignored.push(raw);
      continue;
    }
    if (chains.includes(id)) continue;

    chains.push(id);
    for (const token of chainTokens) {
      const known = tokens.some(
        (t) => t.chainId === token.chainId && t.address.toLowerCase() === token.address.toLowerCase()
      );
      if (!known) tokens.push(token);
    }
  }

  return { chains, tokens, ignored };
}
