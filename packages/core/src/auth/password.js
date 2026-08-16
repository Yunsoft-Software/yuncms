import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const DEFAULTS = Object.freeze({
  N: 65_536,
  r: 8,
  p: 1,
  keyLength: 64,
  saltLength: 16,
  maxmem: 128 * 1024 * 1024,
});

function passwordError(message) {
  const error = new Error(message);
  error.code = 'INVALID_PASSWORD';
  return error;
}

export function assertPasswordInput(password) {
  if (typeof password !== 'string') throw passwordError('Password must be a string');
  if (password.length < 8) throw passwordError('Password must contain at least 8 characters');
  if (password.length > 1024) throw passwordError('Password is too long');
  return password;
}

export async function hashPassword(password, options = {}) {
  assertPasswordInput(password);
  const params = { ...DEFAULTS, ...options };
  const salt = randomBytes(params.saltLength);
  const derived = await scrypt(password, salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: params.maxmem,
  });

  return [
    'scrypt',
    `N=${params.N},r=${params.r},p=${params.p},keyLength=${params.keyLength}`,
    salt.toString('base64url'),
    Buffer.from(derived).toString('base64url'),
  ].join('$');
}

function parseHash(encoded) {
  if (typeof encoded !== 'string') return null;
  const [algorithm, parameterString, saltValue, hashValue, extra] = encoded.split('$');
  if (algorithm !== 'scrypt' || !parameterString || !saltValue || !hashValue || extra !== undefined) return null;

  const parameters = Object.fromEntries(
    parameterString.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, Number(value)];
    }),
  );

  const { N, r, p, keyLength } = parameters;
  if (![N, r, p, keyLength].every(Number.isInteger)) return null;
  if (N < 2 || r < 1 || p < 1 || keyLength < 16 || keyLength > 128) return null;

  try {
    const salt = Buffer.from(saltValue, 'base64url');
    const expected = Buffer.from(hashValue, 'base64url');
    if (salt.length < 8 || expected.length !== keyLength) return null;
    return { N, r, p, keyLength, salt, expected };
  } catch {
    return null;
  }
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 1024) return false;
  const parsed = parseHash(encoded);
  if (!parsed) return false;

  const maxmem = Math.max(DEFAULTS.maxmem, 128 * parsed.N * parsed.r + 1024 * 1024);
  const derived = Buffer.from(await scrypt(password, parsed.salt, parsed.keyLength, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem,
  }));

  return derived.length === parsed.expected.length && timingSafeEqual(derived, parsed.expected);
}
