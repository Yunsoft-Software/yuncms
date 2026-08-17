function rateLimitError(retryAfterSeconds) {
  const error = new Error('Too many requests');
  error.code = 'RATE_LIMITED';
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

export function createFixedWindowRateLimit({
  windowMs,
  max,
  key = (req) => req.ip || req.socket?.remoteAddress || 'unknown',
  maxBuckets = 10_000,
  now = () => Date.now(),
} = {}) {
  if (!Number.isInteger(windowMs) || windowMs < 1000) throw new Error('Rate-limit windowMs must be at least 1000');
  if (!Number.isInteger(max) || max < 1) throw new Error('Rate-limit max must be a positive integer');
  if (!Number.isInteger(maxBuckets) || maxBuckets < 1) throw new Error('Rate-limit maxBuckets must be a positive integer');

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

  return (req, res, next) => {
    const timestamp = now();
    const bucketKey = String(key(req));
    let bucket = buckets.get(bucketKey);

    if (!bucket || bucket.resetAt <= timestamp) {
      if (!bucket) ensureCapacity(timestamp);
      bucket = { count: 0, resetAt: timestamp + windowMs };
      buckets.set(bucketKey, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000));
    res.set('x-ratelimit-limit', String(max));
    res.set('x-ratelimit-remaining', String(remaining));
    res.set('x-ratelimit-reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.set('retry-after', String(retryAfterSeconds));
      next(rateLimitError(retryAfterSeconds));
      return;
    }

    next();
  };
}
