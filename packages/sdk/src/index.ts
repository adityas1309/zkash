export const SOROBAN_RPC = 'https://soroban-testnet.stellar.org';
export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

export type AssetType = 'USDC' | 'XLM';

export {
  proofToBytes,
  publicSignalsToBytes,
  vkToBytes,
  proofToSorobanBytes,
  type SnarkJsProof,
  type SnarkJsVk,
} from './zkProof';
