import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// Internal session admission marker; never accepted from HTTP or user payloads.
export const SECOND_FACTOR_VERIFIED = Symbol('second-factor-verified');
export const PRIMARY_FACTOR_VERIFIED = Symbol('primary-factor-verified');
export const TOTP_POLICY = Object.freeze({ digits: 6, period: 30, window: 1, recoveryCodes: 8, challengeTtlMs: 300_000, enrollmentTtlMs: 600_000, maxAttempts: 10, challengeAttempts: 5, lockMs: 300_000 });

export function generateTotpSecret() {
  const bytes = randomBytes(20);
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; result += ALPHABET[(value >>> bits) & 31]; }
  }
  return result;
}

function decodeSecret(secret) {
  if (typeof secret !== 'string' || !/^[A-Z2-7]{32}$/.test(secret)) throw new Error('Invalid TOTP secret');
  let bits = 0, value = 0; const bytes = [];
  for (const char of secret) {
    value = (value << 5) | ALPHABET.indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}

export function totpAtStep(secret, step, digits = 6) {
  if (!Number.isSafeInteger(step) || step < 0 || ![6, 8].includes(digits)) throw new Error('Invalid TOTP counter');
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decodeSecret(secret)).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}

export function matchTotpStep(secret, code, now = Date.now(), lastUsedStep = -1) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code) || !Number.isFinite(now) || now < 0) return null;
  const current = Math.floor(now / 30_000); let matched = null;
  for (const step of [current, current - 1, current + 1]) {
    if (step < 0) continue;
    const equal = timingSafeEqual(Buffer.from(totpAtStep(secret, step)), Buffer.from(code));
    if (equal && step > Number(lastUsedStep ?? -1) && matched === null) matched = step;
  }
  return matched;
}

export function totpKey(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw Object.assign(new Error('AUTH_TOTP_KEY must be 64 hexadecimal characters'), { code: 'TFA_KEY_INVALID' });
  }
  return Buffer.from(value, 'hex');
}

export function encryptTotpSecret(secret, key, user, phase) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`yuncms:totp:${user}:${phase}`));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptTotpSecret(value, key, user, phase) {
  try {
    const [version, iv, tag, text, ...extra] = String(value).split('.');
    if (version !== 'v1' || extra.length || !iv || !tag || !text) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`yuncms:totp:${user}:${phase}`)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(text, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw Object.assign(new Error('TOTP secret cannot be decrypted with the configured key'), { code: 'TFA_KEY_INVALID' }); }
}

export function totpUri(secret, email) {
  const url = new URL(`otpauth://totp/${encodeURIComponent('YunCMS:' + email)}`);
  for (const [key, value] of Object.entries({ secret, issuer: 'YunCMS', algorithm: 'SHA1', digits: '6', period: '30' })) url.searchParams.set(key, value);
  return url.toString();
}

export function normalizeRecoveryCode(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const code = value.replaceAll('-', '').toLowerCase();
  return /^[a-f0-9]{32}$/.test(code) ? code : null;
}
