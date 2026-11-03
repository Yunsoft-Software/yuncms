import { argon2 as argon2Callback, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2 = promisify(argon2Callback);
const scrypt = promisify(scryptCallback);

const ARGON2_DEFAULTS = Object.freeze({
  memory: 65_536,
  passes: 3,
  parallelism: 1,
  keyLength: 64,
  saltLength: 16,
});

const SCRYPT_DEFAULTS = Object.freeze({
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

function assertArgon2Parameters({ memory, passes, parallelism, keyLength }) {
  if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > 4) {
    throw passwordError('Invalid Argon2 parallelism');
  }
  if (!Number.isInteger(memory) || memory < Math.max(1024, 8 * parallelism) || memory > 262_144) {
    throw passwordError('Invalid Argon2 memory parameter');
  }
  if (!Number.isInteger(passes) || passes < 1 || passes > 16) {
    throw passwordError('Invalid Argon2 passes parameter');
  }
  if (!Number.isInteger(keyLength) || keyLength < 32 || keyLength > 128) {
    throw passwordError('Invalid Argon2 key length');
  }
}

function assertScryptParameters({ N, r, p, keyLength }) {
  const powerOfTwo = Number.isInteger(N) && N > 1 && (N & (N - 1)) === 0;
  if (!powerOfTwo || N > 131_072) throw passwordError('Invalid scrypt cost parameter');
  if (!Number.isInteger(r) || r < 1 || r > 16) throw passwordError('Invalid scrypt block size');
  if (!Number.isInteger(p) || p < 1 || p > 4) throw passwordError('Invalid scrypt parallelization');
  if (!Number.isInteger(keyLength) || keyLength < 32 || keyLength > 128) {
    throw passwordError('Invalid scrypt key length');
  }
}

function resolveHashAlgorithm(options = {}) {
  if (options.algorithm === 'scrypt') return 'scrypt';
  if (options.algorithm === 'argon2id') return 'argon2id';
  if (options.algorithm !== undefined) {
    throw passwordError(`Unsupported password hash algorithm: ${String(options.algorithm)}`);
  }
  if (
    Object.hasOwn(options, 'N')
    && !Object.hasOwn(options, 'memory')
    && !Object.hasOwn(options, 'm')
    && !Object.hasOwn(options, 'passes')
    && !Object.hasOwn(options, 't')
  ) {
    return 'scrypt';
  }
  return 'argon2id';
}

export async function hashPassword(password, options = {}) {
  assertPasswordInput(password);
  const algorithm = resolveHashAlgorithm(options);

  if (algorithm === 'scrypt') {
    const params = { ...SCRYPT_DEFAULTS, ...options };
    assertScryptParameters(params);
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

  const params = {
    memory: options.memory ?? options.m ?? ARGON2_DEFAULTS.memory,
    passes: options.passes ?? options.t ?? ARGON2_DEFAULTS.passes,
    parallelism: options.parallelism ?? options.p ?? ARGON2_DEFAULTS.parallelism,
    keyLength: options.keyLength ?? ARGON2_DEFAULTS.keyLength,
    saltLength: options.saltLength ?? ARGON2_DEFAULTS.saltLength,
  };
  assertArgon2Parameters(params);
  const salt = randomBytes(params.saltLength);
  const derived = await argon2('argon2id', {
    message: password,
    nonce: salt,
    parallelism: params.parallelism,
    tagLength: params.keyLength,
    memory: params.memory,
    passes: params.passes,
  });

  return [
    'argon2id',
    `m=${params.memory},t=${params.passes},p=${params.parallelism},keyLength=${params.keyLength}`,
    salt.toString('base64url'),
    Buffer.from(derived).toString('base64url'),
  ].join('$');
}

function parseParameterMap(parameterString) {
  return Object.fromEntries(
    parameterString.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, Number(value)];
    }),
  );
}

function parseHash(encoded) {
  if (typeof encoded !== 'string') return null;

  if (encoded.startsWith('$argon2id$')) {
    const parts = encoded.split('$').filter(Boolean);
    const hasVersion = parts.length === 5 && parts[1] === 'v=19';
    if (!hasVersion && parts.length !== 4) return null;
    const parameterString = hasVersion ? parts[2] : parts[1];
    const saltValue = hasVersion ? parts[3] : parts[2];
    const hashValue = hasVersion ? parts[4] : parts[3];
    if (!parameterString || !saltValue || !hashValue) return null;

    const parameters = parseParameterMap(parameterString);
    try {
      const salt = Buffer.from(saltValue, 'base64');
      const expected = Buffer.from(hashValue, 'base64');
      const memory = parameters.m;
      const passes = parameters.t;
      const parallelism = parameters.p;
      const keyLength = expected.length;
      assertArgon2Parameters({ memory, passes, parallelism, keyLength });
      if (salt.length < 8 || salt.length > 64) return null;
      return { algorithm: 'argon2id', memory, passes, parallelism, keyLength, salt, expected };
    } catch {
      return null;
    }
  }

  const [algorithm, parameterString, saltValue, hashValue, extra] = encoded.split('$');
  if (!parameterString || !saltValue || !hashValue || extra !== undefined) return null;

  const parameters = parseParameterMap(parameterString);

  if (algorithm === 'argon2id') {
    const memory = parameters.m ?? parameters.memory;
    const passes = parameters.t ?? parameters.passes;
    const parallelism = parameters.p ?? parameters.parallelism;
    const keyLength = parameters.keyLength;
    try {
      assertArgon2Parameters({ memory, passes, parallelism, keyLength });
      const salt = Buffer.from(saltValue, 'base64url');
      const expected = Buffer.from(hashValue, 'base64url');
      if (salt.length < 8 || salt.length > 64 || expected.length !== keyLength) return null;
      return { algorithm: 'argon2id', memory, passes, parallelism, keyLength, salt, expected };
    } catch {
      return null;
    }
  }

  if (algorithm === 'scrypt') {
    const { N, r, p, keyLength } = parameters;
    try {
      assertScryptParameters({ N, r, p, keyLength });
      const salt = Buffer.from(saltValue, 'base64url');
      const expected = Buffer.from(hashValue, 'base64url');
      if (salt.length < 8 || salt.length > 64 || expected.length !== keyLength) return null;
      return { algorithm: 'scrypt', N, r, p, keyLength, salt, expected };
    } catch {
      return null;
    }
  }

  return null;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 1024) return false;
  const parsed = parseHash(encoded);
  if (!parsed) return false;

  if (parsed.algorithm === 'argon2id') {
    const derived = Buffer.from(await argon2('argon2id', {
      message: password,
      nonce: parsed.salt,
      parallelism: parsed.parallelism,
      tagLength: parsed.keyLength,
      memory: parsed.memory,
      passes: parsed.passes,
    }));
    return derived.length === parsed.expected.length && timingSafeEqual(derived, parsed.expected);
  }

  const maxmem = Math.max(SCRYPT_DEFAULTS.maxmem, 128 * parsed.N * parsed.r + 1024 * 1024);
  const derived = Buffer.from(await scrypt(password, parsed.salt, parsed.keyLength, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem,
  }));

  return derived.length === parsed.expected.length && timingSafeEqual(derived, parsed.expected);
}
