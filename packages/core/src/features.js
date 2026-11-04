// SPDX-FileCopyrightText: 2026 Yunsoft Software
// SPDX-License-Identifier: MIT
import { createHash, createPublicKey, verify } from 'node:crypto';
import { domainToASCII } from 'node:url';

export const FEATURE_CATALOG = Object.freeze({
  aiAssistant: Object.freeze({ name: 'AI assistant', tier: 'free' }),
  aiFlows: Object.freeze({ name: 'AI Flow operations', tier: 'free' }),
  mcp: Object.freeze({ name: 'MCP', tier: 'free' }),
  flowScripts: Object.freeze({ name: 'Flow scripts', tier: 'free' }),
  contentHistory: Object.freeze({ name: 'Content history', tier: 'premium' }),
});

export function featureError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function assertFeatureName(name) {
  if (typeof name !== 'string' || !Object.hasOwn(FEATURE_CATALOG, name)) {
    throw featureError('INVALID_FEATURE', 'Unknown feature');
  }
  return name;
}

function hostname(input) {
  if (typeof input !== 'string' || !input || input !== input.trim()
    || /[\s/:@?#*\\]/.test(input)) return null;
  const value = domainToASCII(input.toLowerCase().replace(/\.$/, ''));
  return value && value.length <= 253 && value.split('.').every(part =>
    part.length > 0 && part.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part))
    ? value : null;
}

function jsonSegment(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('Invalid encoding');
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.toString('base64url') !== segment) throw new Error('Non-canonical encoding');
  return JSON.parse(bytes.toString('utf8'));
}

export function verifyFeatureLicense({ token, publicKey, domain, instanceId = null, now = Date.now() } = {}) {
  if (!token) return { status: 'missing', capabilities: {} };
  try {
    if (typeof token !== 'string' || token.length > 32_768 || typeof publicKey !== 'string') throw new Error();
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    const header = jsonSegment(parts[0]);
    const key = createPublicKey(publicKey.replace(/\\n/g, '\n'));
    if (key.asymmetricKeyType !== 'ed25519' || header.alg !== 'EdDSA'
      || header.crv !== 'Ed25519' || header.typ !== 'YUNSOFT-ENTITLEMENT+JWT') throw new Error();
    const kid = createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
    const signature = Buffer.from(parts[2], 'base64url');
    if (header.kid !== kid || signature.length !== 64 || signature.toString('base64url') !== parts[2]
      || !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, signature)) throw new Error();
    const payload = jsonSegment(parts[1]);
    const seconds = Math.floor(now / 1000);
    if (payload.iss !== 'yunsoft-commerce' || payload.productCode !== 'yuncms_premium'
      || payload.status !== 'active' || typeof payload.sub !== 'string' || !payload.sub
      || !Number.isSafeInteger(payload.nbf) || payload.nbf > seconds
      || !Number.isSafeInteger(payload.iat) || payload.iat > seconds + 30
      || !['one_time_perpetual', 'monthly_term'].includes(payload.billingModel)) throw new Error();
    if (payload.exp !== null && (!Number.isSafeInteger(payload.exp) || payload.exp <= seconds)) {
      return { status: 'expired', capabilities: {} };
    }
    if (payload.exp === null && payload.billingModel !== 'one_time_perpetual') throw new Error();
    const actualDomain = hostname(domain);
    const hosts = [...(Array.isArray(payload.allowedHosts) ? payload.allowedHosts : []),
      ...(Array.isArray(payload.stagingHosts) ? payload.stagingHosts : [])];
    if (!actualDomain || !hosts.some(host => hostname(host) === actualDomain)) throw new Error();
    if (payload.activatedInstanceId != null && (!instanceId || payload.activatedInstanceId !== instanceId)) throw new Error();
    const capabilities = {};
    for (const name of Object.keys(FEATURE_CATALOG)) capabilities[name] = payload.capabilities?.[name] === true;
    return { status: 'active', capabilities, domain: actualDomain, licenseId: payload.licenseId || payload.sub };
  } catch {
    return { status: 'invalid', capabilities: {} };
  }
}

export function createFeaturePolicy(input = process.env) {
  const disabledInput = input.disabled ?? input.YUNCMS_FEATURES_DISABLED ?? '';
  const disabled = Array.isArray(disabledInput) ? [...disabledInput] : String(disabledInput).split(',').map(value => value.trim()).filter(Boolean);
  disabled.forEach(assertFeatureName);
  const configuration = {
    token: input.token ?? input.YUNCMS_LICENSE_TOKEN,
    publicKey: input.publicKey ?? input.YUNCMS_LICENSE_PUBLIC_KEY,
    domain: input.domain ?? input.YUNCMS_LICENSE_DOMAIN,
    instanceId: input.instanceId ?? input.YUNCMS_LICENSE_INSTANCE_ID,
  };
  return Object.freeze({
    withToken(token) {
      return createFeaturePolicy({ ...configuration, token, disabled });
    },
    describe(name) {
      assertFeatureName(name);
      const license = verifyFeatureLicense(configuration);
      const licensed = FEATURE_CATALOG[name].tier === 'free' || license.capabilities[name] === true;
      const ownerDisabled = disabled.includes(name);
      return { ...FEATURE_CATALOG[name], licensed, ownerDisabled, allowed: licensed && !ownerDisabled };
    },
    licenseStatus() {
      const { capabilities: _capabilities, ...status } = verifyFeatureLicense(configuration);
      return status;
    },
  });
}
