import { loadEnvFile } from 'node:process';

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
  return {
    server: {
      host: readString(env.HOST, '127.0.0.1'),
      port: readInteger(env.PORT, 8055, 'PORT', { min: 1, max: 65535 }),
      studioOrigin: readString(env.STUDIO_ORIGIN, 'http://localhost:5173'),
    },
    logging: {
      level: readString(env.LOG_LEVEL, 'info'),
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
  };
}
