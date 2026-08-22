function cacheError(message) {
  const error = new Error(message);
  error.code = 'INVALID_CACHE_CONFIG';
  return error;
}

export function isCacheStore(store) {
  return Boolean(
    store
    && typeof store.get === 'function'
    && typeof store.set === 'function'
    && typeof store.delete === 'function'
    && typeof store.clear === 'function',
  );
}

export class MemoryCacheStore {
  constructor({
    ttlMs = 30_000,
    maxEntries = 5_000,
    now = () => Date.now(),
  } = {}) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1) throw cacheError('Cache ttlMs must be a positive integer');
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw cacheError('Cache maxEntries must be a positive integer');
    }
    if (typeof now !== 'function') throw cacheError('Cache now must be a function');

    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
  }

  #deleteExpired(timestamp) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= timestamp) this.entries.delete(key);
    }
  }

  #ensureCapacity(timestamp, incomingKey) {
    this.#deleteExpired(timestamp);
    if (this.entries.has(incomingKey)) return;
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  async get(key) {
    const entry = this.entries.get(String(key));
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(String(key));
      return undefined;
    }
    return entry.value;
  }

  async set(key, value, { ttlMs = this.ttlMs } = {}) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1) throw cacheError('Cache entry ttlMs must be a positive integer');
    const normalizedKey = String(key);
    const timestamp = this.now();
    this.#ensureCapacity(timestamp, normalizedKey);
    this.entries.delete(normalizedKey);
    this.entries.set(normalizedKey, {
      value,
      expiresAt: timestamp + ttlMs,
    });
    return value;
  }

  async delete(key) {
    return this.entries.delete(String(key));
  }

  async clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}
