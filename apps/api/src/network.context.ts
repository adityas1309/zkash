import { AsyncLocalStorage } from 'async_hooks';

export const networkStorage = new AsyncLocalStorage<{ isMainnet: boolean }>();

export function isMainnetContext(): boolean {
  const store = networkStorage.getStore();
  if (store !== undefined) {
    return store.isMainnet;
  }
  return process.env.STELLAR_NETWORK === 'mainnet';
}

export function getContractAddress(
  name:
    | 'GROTH16_VERIFIER_ADDRESS'
    | 'SHIELDED_POOL_ADDRESS'
    | 'ZK_SWAP_ADDRESS'
    | 'SHIELDED_POOL_XLM_ADDRESS',
): string {
  const isMainnet = isMainnetContext();
  const prefix = isMainnet ? 'MAINNET_' : 'TESTNET_';

  // Check prefixed first, fallback to unprefixed for backward compatibility
  const value = process.env[`${prefix}${name}`] || process.env[name];
  if (!value) {
    console.warn(
      `[getContractAddress] Missing environment variable for ${isMainnet ? 'Mainnet' : 'Testnet'} ${name}`,
    );
  }
  return value || '';
}

export function getHorizonUrl(): string {
  const isMainnet = isMainnetContext();
  const defaultUrl = isMainnet
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';
  const prefix = isMainnet ? 'MAINNET_' : 'TESTNET_';
  const configured = process.env[`${prefix}HORIZON_URL`] || process.env.HORIZON_URL;
  return configured || defaultUrl;
}

export function getSorobanRpcUrl(): string {
  const isMainnet = isMainnetContext();
  const defaultUrl = isMainnet
    ? 'https://mainnet.sorobanrpc.com'
    : 'https://soroban-testnet.stellar.org';
  const prefix = isMainnet ? 'MAINNET_' : 'TESTNET_';
  const configured = process.env[`${prefix}RPC_URL`] || process.env.RPC_URL;
  // Special guard: If someone has RPC_URL=https://mainnet.sorobanrpc.com but we are on testnet,
  // it shouldn't fallback to the mainnet one.
  if (!isMainnet && configured && configured.includes('mainnet')) {
    return defaultUrl;
  }
  if (isMainnet && configured && configured.includes('testnet')) {
    return defaultUrl;
  }
  return configured || defaultUrl;
}
