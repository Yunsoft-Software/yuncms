import { createHash, randomBytes } from 'node:crypto';

const PREFIXES = Object.freeze({
  access: 'yca',
  refresh: 'ycr',
  api: 'yct',
  reset: 'ycp',
  verify: 'ycv',
});

export function hashToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    const error = new Error('Token is required');
    error.code = 'INVALID_TOKEN';
    throw error;
  }
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createOpaqueToken(type, { bytes = 32 } = {}) {
  const prefix = PREFIXES[type];
  if (!prefix) throw new Error(`Unknown token type: ${type}`);
  if (!Number.isInteger(bytes) || bytes < 24 || bytes > 128) {
    throw new Error('Token byte length must be between 24 and 128');
  }

  const token = `${prefix}_${randomBytes(bytes).toString('base64url')}`;
  return {
    token,
    hash: hashToken(token),
  };
}

export function tokenType(token) {
  if (typeof token !== 'string') return null;
  const prefix = token.slice(0, 3);
  return Object.entries(PREFIXES).find(([, value]) => value === prefix)?.[0] ?? null;
}
