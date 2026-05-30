import type { EnrichmentCacheValue } from "./enrichmentTypes";

type CacheStore = Map<string, EnrichmentCacheValue<unknown>>;

declare global {
  var __TRAAK_SPORTS_ENRICHMENT_CACHE__: CacheStore | undefined;
}

function getStore() {
  if (!globalThis.__TRAAK_SPORTS_ENRICHMENT_CACHE__) {
    globalThis.__TRAAK_SPORTS_ENRICHMENT_CACHE__ = new Map();
  }
  return globalThis.__TRAAK_SPORTS_ENRICHMENT_CACHE__;
}

export function getCachedValue<T>(key: string) {
  const entry = getStore().get(key) as EnrichmentCacheValue<T> | undefined;
  if (!entry || entry.expiresAt <= Date.now()) return null;
  if (entry.value !== undefined) return entry.value;
  return null;
}

export function getCachedPromise<T>(key: string) {
  const entry = getStore().get(key) as EnrichmentCacheValue<T> | undefined;
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.promise ?? null;
}

export function setCachedPromise<T>(key: string, promise: Promise<T>, ttlMs: number) {
  getStore().set(key, { expiresAt: Date.now() + ttlMs, promise });
}

export function setCachedValue<T>(key: string, value: T, ttlMs: number) {
  getStore().set(key, { expiresAt: Date.now() + ttlMs, value });
}

export async function memoizeAsync<T>(key: string, ttlMs: number, loader: () => Promise<T>) {
  const cached = getCachedValue<T>(key);
  if (cached !== null) return cached;
  const existing = getCachedPromise<T>(key);
  if (existing) return existing;
  const promise = loader();
  setCachedPromise(key, promise, ttlMs);
  try {
    const value = await promise;
    setCachedValue(key, value, ttlMs);
    return value;
  } catch (error) {
    getStore().delete(key);
    throw error;
  }
}

