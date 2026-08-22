function rateLimitError(retryAfterSeconds) {
  const error = new Error('Too many requests');
  error.code = 'RATE_LIMITED';
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

function sharedStateError() {
  const error = new Error('Shared rate-limit state is unavailable');
  error.code = 'SHARED_RATE_LIMIT_UNAVAILABLE';
  error.status = 503;
  return error;
}

function createMemoryConsumer({ windowMs, maxBuckets, now }) {
  const buckets = new Map();
  function ensureCapacity(timestamp) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= timestamp) buckets.delete(bucketKey);
    }
    while (buckets.size >= maxBuckets) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey === undefined) break;
      buckets.delete(oldestKey);
    }
  }
  return (bucketKey) => {
    const timestamp = now();
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= timestamp) {
      if (!bucket) ensureCapacity(timestamp);
      bucket = { count: 0, resetAt: timestamp + windowMs };
      buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    return { count: bucket.count, resetAt: bucket.resetAt, retryAfterMs: Math.max(1, bucket.resetAt - timestamp) };
  };
}

export function createFixedWindowRateLimit({
  windowMs,
  max,
  key = (req) => req.ip || req.socket?.remoteAddress || 'unknown',
  maxBuckets = 10_000,
  now = () => Date.now(),
  store = null,
  scope = 'api',
  failureMode = 'best-effort',
  logger = console,
} = {}) {
  if (!Number.isInteger(windowMs) || windowMs < 1000) throw new Error('Rate-limit windowMs must be at least 1000');
  if (!Number.isInteger(max) || max < 1) throw new Error('Rate-limit max must be a positive integer');
  if (!Number.isInteger(maxBuckets) || maxBuckets < 1) throw new Error('Rate-limit maxBuckets must be a positive integer');
  if (!['best-effort', 'required'].includes(failureMode)) throw new Error('Invalid rate-limit failure mode');

  const consumeMemory = createMemoryConsumer({ windowMs, maxBuckets, now });

  return async (req, res, next) => {
    const bucketKey = String(key(req));
    let bucket;
    if (store) {
      try {
        bucket = await store.consume(bucketKey, { windowMs, max, scope });
      } catch (error) {
        if (failureMode === 'required') return next(sharedStateError());
        logger?.warn?.('Shared rate limiter unavailable; using process-local fallback', {
          scope,
          requestId: req.id ?? null,
          code: error?.code ?? null,
        });
        bucket = consumeMemory(bucketKey);
      }
    } else {
      bucket = consumeMemory(bucketKey);
    }

    const remaining = Math.max(0, max - bucket.count);
    const retryAfterSeconds = Math.max(1, Math.ceil(bucket.retryAfterMs / 1000));
    res.set('x-ratelimit-limit', String(max));
    res.set('x-ratelimit-remaining', String(remaining));
    res.set('x-ratelimit-reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.set('retry-after', String(retryAfterSeconds));
      return next(rateLimitError(retryAfterSeconds));
    }
    return next();
  };
}
