// SPDX-FileCopyrightText: 2026 Yunsoft Software
// SPDX-License-Identifier: MIT
import { createHash, createPublicKey, verify } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

export const OFFICIAL_LICENSE_PUBLIC_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEAhUUk9byGuFTpdDD2i8H30BX2kaizm0u4DZrlCfVLFtE=',
  '-----END PUBLIC KEY-----',
].join('\n');
export const OFFICIAL_LICENSE_KEY_ID = '1cbcc4d3173d0c15';

export const FEATURE_CATALOG = Object.freeze({
  aiAssistant: Object.freeze({ name: 'AI assistant', tier: 'free' }),
  aiFlows: Object.freeze({ name: 'AI Flow operations', tier: 'free' }),
  mcp: Object.freeze({ name: 'MCP', tier: 'free' }),
  flowScripts: Object.freeze({ name: 'Flow scripts', tier: 'free' }),
  contentHistory: Object.freeze({ name: 'Content history', tier: 'premium' }),
  whiteLabel: Object.freeze({ name: 'White-label branding', tier: 'premium', defaultEnabled: false }),
});

export function effectiveFeatureState(policy, override) {
  const enabled = policy.allowed && (override ?? policy.defaultEnabled ?? true);
  return { ...policy, enabled, reason: !policy.licensed ? 'license_required'
    : policy.ownerDisabled ? 'owner_disabled' : !enabled ? (override === undefined && policy.defaultEnabled === false ? 'default_disabled' : 'administrator_disabled') : null };
}

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

function nonLocalOriginHostname(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return null;
  }
  const host = hostname(parsed.hostname);
  if (!host || !host.includes('.') || isIP(host) !== 0) return null;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
  return host;
}

export function resolveLicenseDomain(input = {}) {
  const explicit = input.domain ?? input.YUNCMS_LICENSE_DOMAIN;
  if (explicit !== undefined && explicit !== null && (typeof explicit !== 'string' || explicit.trim() !== '')) {
    return typeof explicit === 'string' ? explicit.trim() : explicit;
  }
  for (const candidate of [
    input.publicUrl ?? input.AUTH_PUBLIC_URL,
    input.yuncmsPublicUrl ?? input.YUNCMS_PUBLIC_URL,
    input.studioOrigin ?? input.STUDIO_ORIGIN,
  ]) {
    const derived = nonLocalOriginHostname(candidate);
    if (derived) return derived;
  }
  return null;
}

function resolvePublicKey(publicKey) {
  if (publicKey === undefined || publicKey === null) return OFFICIAL_LICENSE_PUBLIC_KEY;
  if (typeof publicKey !== 'string') return null;
  return publicKey.trim() ? publicKey : OFFICIAL_LICENSE_PUBLIC_KEY;
}

function jsonSegment(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('Invalid encoding');
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.toString('base64url') !== segment) throw new Error('Non-canonical encoding');
  return JSON.parse(bytes.toString('utf8'));
}

export function verifyFeatureLicense({ token, publicKey, domain, instanceId = null, now = Date.now() } = {}) {
  const normalizedToken = typeof token === 'string' ? token.trim() : token;
  if (!normalizedToken) return { status: 'missing', capabilities: {} };
  try {
    const effectivePublicKey = resolvePublicKey(publicKey);
    if (typeof normalizedToken !== 'string' || normalizedToken.length > 32_768 || typeof effectivePublicKey !== 'string') throw new Error();
    const parts = normalizedToken.split('.');
    if (parts.length !== 3) throw new Error();
    const header = jsonSegment(parts[0]);
    const key = createPublicKey(effectivePublicKey.replace(/\\n/g, '\n'));
    if (key.asymmetricKeyType !== 'ed25519' || header.alg !== 'EdDSA'
      || header.crv !== 'Ed25519' || header.typ !== 'YUNSOFT-ENTITLEMENT+JWT') throw new Error();
    const kid = createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
    const signature = Buffer.from(parts[2], 'base64url');
    if (header.kid !== kid || signature.length !== 64 || signature.toString('base64url') !== parts[2]
      || !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, signature)) throw new Error();
    const payload = jsonSegment(parts[1]);
    const seconds = Math.floor(now / 1000);
    if (payload.iss !== 'yunsoft-commerce' || payload.productCode !== 'yuncms_premium'
      || !['active', 'expired'].includes(payload.status) || typeof payload.sub !== 'string' || !payload.sub
      || !Number.isSafeInteger(payload.nbf) || payload.nbf > seconds
      || !Number.isSafeInteger(payload.iat) || payload.iat > seconds + 30
      || !['one_time_perpetual', 'monthly_term'].includes(payload.billingModel)) throw new Error();
    if (payload.exp !== null && (!Number.isSafeInteger(payload.exp) || Math.abs(payload.exp) > 8_640_000_000_000)) {
      throw new Error();
    }
    if (payload.exp === null && payload.billingModel !== 'one_time_perpetual') throw new Error();
    const periodMonths = payload.periodMonths ?? null;
    if (periodMonths !== null && (payload.billingModel !== 'monthly_term'
      || !Number.isSafeInteger(periodMonths) || periodMonths < 1)) throw new Error();
    const entitlementVersion = payload.entitlementVersion ?? 1;
    if (!Number.isSafeInteger(entitlementVersion) || entitlementVersion < 1) throw new Error();
    if (payload.licenseId !== undefined && typeof payload.licenseId !== 'string') throw new Error();
    const actualDomain = hostname(domain);
    const hosts = [...(Array.isArray(payload.allowedHosts) ? payload.allowedHosts : []),
      ...(Array.isArray(payload.stagingHosts) ? payload.stagingHosts : [])];
    if (!actualDomain || !hosts.some(host => hostname(host) === actualDomain)) throw new Error();
    if (payload.activatedInstanceId != null && (!instanceId || payload.activatedInstanceId !== instanceId)) throw new Error();
    const expiresAt = payload.exp === null ? null : new Date(payload.exp * 1000).toISOString();
    const metadata = {
      domain: actualDomain,
      licenseId: payload.licenseId || payload.sub,
      billingModel: payload.billingModel,
      periodMonths,
      expiresAt,
      entitlementVersion,
      iat: payload.iat,
    };
    if (payload.status === 'expired' || (payload.exp !== null && payload.exp <= seconds)) {
      return { status: 'expired', capabilities: {}, ...metadata };
    }
    const capabilities = {};
    for (const name of Object.keys(FEATURE_CATALOG)) capabilities[name] = payload.capabilities?.[name] === true;
    return { status: 'active', capabilities, ...metadata };
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
    domain: resolveLicenseDomain(input),
    instanceId: input.instanceId ?? input.YUNCMS_LICENSE_INSTANCE_ID,
  };
  return Object.freeze({
    withToken(token) {
      return createFeaturePolicy({ ...configuration, token, disabled });
    },
    canReplaceWith(nextToken) {
      const next = verifyFeatureLicense({ ...configuration, token: nextToken });
      if (next.status !== 'active') return false;
      const current = verifyFeatureLicense(configuration);
      if (!['active', 'expired'].includes(current.status) || current.licenseId !== next.licenseId) return true;
      if (next.entitlementVersion !== current.entitlementVersion) {
        return next.entitlementVersion > current.entitlementVersion;
      }
      if (next.iat < current.iat) return false;
      if (next.expiresAt !== null && (current.expiresAt === null || Date.parse(next.expiresAt) < Date.parse(current.expiresAt))) {
        return false;
      }
      return true;
    },
    describe(name) {
      assertFeatureName(name);
      const license = verifyFeatureLicense(configuration);
      const licensed = FEATURE_CATALOG[name].tier === 'free' || license.capabilities[name] === true;
      const ownerDisabled = disabled.includes(name);
      return { ...FEATURE_CATALOG[name], licensed, ownerDisabled, allowed: licensed && !ownerDisabled };
    },
    licenseStatus() {
      const { capabilities: _capabilities, iat: _iat, ...status } = verifyFeatureLicense(configuration);
      if (status.domain === undefined) {
        const configuredDomain = hostname(configuration.domain);
        if (configuredDomain) status.configuredDomain = configuredDomain;
      }
      return status;
    },
  });
}
