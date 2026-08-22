import { loadEnvFile } from 'node:process';

export const DEFAULT_SERVER_PORT = 3008;

function readInteger(value, fallback, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function readBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw new Error(`Expected boolean value, received: ${value}`);
}

function readString(value, fallback = '') {
  return value === undefined ? fallback : String(value);
}

function readStore(value, fallback, name) {
  const store = readString(value, fallback).trim().toLowerCase();
  if (!['memory', 'redis'].includes(store)) {
    throw new Error(`${name} must be memory or redis, received: ${store}`);
  }
  return store;
}

function readFailureMode(value, fallback = 'best-effort') {
  const mode = readString(value, fallback).trim().toLowerCase();
  if (!['best-effort', 'required'].includes(mode)) {
    throw new Error(`RATE_LIMIT_FAILURE_MODE must be best-effort or required, received: ${mode}`);
  }
  return mode;
}

export function loadEnvFileIfPresent(path = '.env') {
  try {
    loadEnvFile(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export function loadConfig(env = process.env) {
  const serverPort = readInteger(env.PORT, DEFAULT_SERVER_PORT, 'PORT', { min: 1, max: 65535 });
  const studioOrigin = readString(env.STUDIO_ORIGIN, `http://localhost:${serverPort}`);
  const cacheStore = readStore(env.CACHE_STORE, 'memory', 'CACHE_STORE');
  const apiRateLimitStore = readStore(env.API_RATE_LIMIT_STORE, 'memory', 'API_RATE_LIMIT_STORE');
  const authRateLimitStore = readStore(env.AUTH_RATE_LIMIT_STORE, apiRateLimitStore, 'AUTH_RATE_LIMIT_STORE');
  const redisUrl = readString(env.REDIS_URL, '') || null;
  if ([cacheStore, apiRateLimitStore, authRateLimitStore].includes('redis') && !redisUrl) {
    throw new Error('REDIS_URL is required when any cache or rate-limit store is redis');
  }

  return {
    server: {
      host: readString(env.HOST, '127.0.0.1'),
      port: serverPort,
      studioOrigin,
      trustProxyHops: readInteger(env.TRUST_PROXY_HOPS, 0, 'TRUST_PROXY_HOPS', { min: 0, max: 10 }),
      rateLimit: {
        enabled: readBoolean(env.API_RATE_LIMIT_ENABLED, true),
        store: apiRateLimitStore,
        failureMode: readFailureMode(env.RATE_LIMIT_FAILURE_MODE),
        windowMs: readInteger(env.API_RATE_LIMIT_WINDOW_MS, 60_000, 'API_RATE_LIMIT_WINDOW_MS', { min: 1000, max: 24 * 60 * 60 * 1000 }),
        max: readInteger(env.API_RATE_LIMIT_MAX, 300, 'API_RATE_LIMIT_MAX', { min: 1, max: 1_000_000 }),
        maxBuckets: readInteger(env.API_RATE_LIMIT_MAX_BUCKETS, 10_000, 'API_RATE_LIMIT_MAX_BUCKETS', { min: 1, max: 1_000_000 }),
      },
      pressure: {
        enabled: readBoolean(env.PRESSURE_LIMIT_ENABLED, true),
        maxConcurrent: readInteger(env.PRESSURE_MAX_CONCURRENT, 250, 'PRESSURE_MAX_CONCURRENT', { min: 1, max: 100_000 }),
        maxHeapPercent: readInteger(env.PRESSURE_MAX_HEAP_PERCENT, 95, 'PRESSURE_MAX_HEAP_PERCENT', { min: 1, max: 100 }),
        retryAfterSeconds: readInteger(env.PRESSURE_RETRY_AFTER_SECONDS, 1, 'PRESSURE_RETRY_AFTER_SECONDS', { min: 1, max: 3600 }),
      },
    },
    logging: { level: readString(env.LOG_LEVEL, 'info') },
    cache: {
      enabled: readBoolean(env.CACHE_ENABLED, true),
      store: cacheStore,
      ttlMs: readInteger(env.CACHE_TTL_MS, 30_000, 'CACHE_TTL_MS', { min: 1, max: 24 * 60 * 60 * 1000 }),
      maxEntries: readInteger(env.CACHE_MAX_ENTRIES, 5_000, 'CACHE_MAX_ENTRIES', { min: 1, max: 1_000_000 }),
    },
    redis: {
      url: redisUrl,
      prefix: readString(env.REDIS_PREFIX, 'yuncms:default:'),
      required: readBoolean(env.REDIS_REQUIRED, false),
      connectTimeoutMs: readInteger(env.REDIS_CONNECT_TIMEOUT_MS, 5_000, 'REDIS_CONNECT_TIMEOUT_MS', { min: 100, max: 60_000 }),
      commandTimeoutMs: readInteger(env.REDIS_COMMAND_TIMEOUT_MS, 3_000, 'REDIS_COMMAND_TIMEOUT_MS', { min: 100, max: 60_000 }),
    },
    database: {
      host: readString(env.DB_HOST, '127.0.0.1'),
      port: readInteger(env.DB_PORT, 3306, 'DB_PORT', { min: 1, max: 65535 }),
      database: readString(env.DB_DATABASE, 'yuncms'),
      user: readString(env.DB_USER, 'yuncms'),
      password: readString(env.DB_PASSWORD, ''),
      connectionLimit: readInteger(env.DB_CONNECTION_LIMIT, 10, 'DB_CONNECTION_LIMIT', { min: 1, max: 1000 }),
      ssl: readBoolean(env.DB_SSL, false),
    },
    storage: {
      localRoot: readString(env.FILES_LOCAL_ROOT, '.yuncms/uploads'),
      maxUploadBytes: readInteger(env.FILES_MAX_UPLOAD_BYTES, 25 * 1024 * 1024, 'FILES_MAX_UPLOAD_BYTES', { min: 1, max: 1024 * 1024 * 1024 }),
      s3: {
        bucket: readString(env.S3_BUCKET, ''),
        region: readString(env.S3_REGION, 'us-east-1'),
        endpoint: readString(env.S3_ENDPOINT, '') || null,
        accessKeyId: readString(env.S3_ACCESS_KEY_ID, '') || null,
        secretAccessKey: readString(env.S3_SECRET_ACCESS_KEY, '') || null,
        forcePathStyle: readBoolean(env.S3_FORCE_PATH_STYLE, false),
      },
    },
    audit: {
      retentionDays: readInteger(env.AUDIT_RETENTION_DAYS, 90, 'AUDIT_RETENTION_DAYS', { min: 1, max: 3650 }),
      cleanupBatchSize: readInteger(env.AUDIT_CLEANUP_BATCH_SIZE, 1000, 'AUDIT_CLEANUP_BATCH_SIZE', { min: 1, max: 5000 }),
      cleanupMaxBatches: readInteger(env.AUDIT_CLEANUP_MAX_BATCHES, 100, 'AUDIT_CLEANUP_MAX_BATCHES', { min: 1, max: 1000 }),
    },
    mail: {
      host: readString(env.SMTP_HOST, ''),
      port: readInteger(env.SMTP_PORT, 587, 'SMTP_PORT', { min: 1, max: 65535 }),
      secure: readBoolean(env.SMTP_SECURE, false),
      user: readString(env.SMTP_USER, '') || null,
      password: readString(env.SMTP_PASSWORD, '') || null,
      from: readString(env.SMTP_FROM, '') || null,
    },
    auth: {
      publicUrl: readString(env.AUTH_PUBLIC_URL, studioOrigin).replace(/\/$/, ''),
      rateLimit: {
        store: authRateLimitStore,
        failureMode: readFailureMode(env.RATE_LIMIT_FAILURE_MODE),
        loginWindowMs: readInteger(env.AUTH_LOGIN_RATE_WINDOW_MS, 60_000, 'AUTH_LOGIN_RATE_WINDOW_MS', { min: 1000, max: 24 * 60 * 60 * 1000 }),
        loginMax: readInteger(env.AUTH_LOGIN_RATE_MAX, 10, 'AUTH_LOGIN_RATE_MAX', { min: 1, max: 100_000 }),
        refreshWindowMs: readInteger(env.AUTH_REFRESH_RATE_WINDOW_MS, 60_000, 'AUTH_REFRESH_RATE_WINDOW_MS', { min: 1000, max: 24 * 60 * 60 * 1000 }),
        refreshMax: readInteger(env.AUTH_REFRESH_RATE_MAX, 30, 'AUTH_REFRESH_RATE_MAX', { min: 1, max: 100_000 }),
        actionWindowMs: readInteger(env.AUTH_ACTION_RATE_WINDOW_MS, 15 * 60_000, 'AUTH_ACTION_RATE_WINDOW_MS', { min: 1000, max: 24 * 60 * 60 * 1000 }),
        actionMax: readInteger(env.AUTH_ACTION_RATE_MAX, 5, 'AUTH_ACTION_RATE_MAX', { min: 1, max: 100_000 }),
      },
    },
  };
}
