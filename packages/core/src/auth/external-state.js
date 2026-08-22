import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

function authStateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stateKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw authStateError('INVALID_AUTH_PROVIDER_CONFIG', 'AUTH_STATE_SECRET must contain at least 32 characters');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function createExternalAuthState(bytes = 32) {
  if (!Number.isInteger(bytes) || bytes < 24 || bytes > 64) throw new Error('External auth state bytes must be between 24 and 64');
  return randomBytes(bytes).toString('base64url');
}

export function hashExternalAuthState(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 512) {
    throw authStateError('INVALID_AUTH_TRANSACTION', 'External auth state is invalid');
  }
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function constantTimeStateEqual(left, right) {
  const a = Buffer.from(hashExternalAuthState(left), 'hex');
  const b = Buffer.from(hashExternalAuthState(right), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function encryptExternalAuthSecret(secret, value) {
  if (value == null) return null;
  const key = stateKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptExternalAuthSecret(secret, value) {
  if (value == null) return null;
  const parts = String(value).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw authStateError('INVALID_AUTH_TRANSACTION', 'External auth transaction secret is invalid');
  try {
    const key = stateKey(secret);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext);
  } catch (error) {
    throw authStateError('INVALID_AUTH_TRANSACTION', `External auth transaction secret could not be verified: ${error?.code ?? 'decrypt_failed'}`);
  }
}

export function assertLocalRedirectTarget(value, fallback = '/') {
  if (value == null || value === '') return fallback;
  const target = String(value);
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\') || /[\r\n\0]/.test(target) || target.length > 512) {
    throw authStateError('INVALID_REDIRECT_TARGET', 'External auth redirect target must be a local path');
  }
  return target;
}
