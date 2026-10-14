import { defineChain } from 'viem';

/**
 * Robinhood Chain viem definitions (not shipped by the installed viem).
 * RPC and explorer URLs are overridable via environment variables, matching chains.ts.
 */
export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: {
    default: {
      name: 'Robinhood Explorer',
      url: process.env.ROBINHOOD_EXPLORER_URL || 'https://explorer.mainnet.chain.robinhood.com',
    },
  },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ROBINHOOD_TESTNET_RPC_URL || 'https://rpc.testnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: {
      name: 'Robinhood Testnet Explorer',
      url: process.env.ROBINHOOD_TESTNET_EXPLORER_URL || 'https://explorer.testnet.chain.robinhood.com',
    },
  },
  testnet: true,
});
