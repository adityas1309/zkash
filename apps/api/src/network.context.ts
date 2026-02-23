import { AsyncLocalStorage } from 'async_hooks';

export const networkStorage = new AsyncLocalStorage<{ isMainnet: boolean }>();

export function isMainnetContext(): boolean {
    const store = networkStorage.getStore();
    if (store !== undefined) {
        return store.isMainnet;
    }
    return process.env.STELLAR_NETWORK === 'mainnet';
}
