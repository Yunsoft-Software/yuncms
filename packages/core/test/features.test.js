import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import {
  OFFICIAL_LICENSE_KEY_ID,
  OFFICIAL_LICENSE_PUBLIC_KEY,
  createFeaturePolicy,
  effectiveFeatureState,
  resolveLicenseDomain,
  verifyFeatureLicense,
} from '../src/features.js';
import { parseItemRevision, assertItemRevision, contentTracking, restrictMutationToKeys } from '../src/content-state.js';
import { historyRestoreValues } from '../src/premium/content-revisions-service.js';
import { historySnapshot } from '../src/premium/history-recorder.js';

test('history restores only native writable business fields while preserving server-owned defaults', () => {
  const schema = { primary_key: 'id', fields: {
    id: {}, title: {}, removed: undefined, readonly: { readonly: true },
    owner: { schema_metadata: JSON.stringify({ defaultPreset: 'current_user' }) },
    actor: { schema_metadata: { defaultPreset: 'current_user' } },
    updated_at: { schema_metadata: { special: 'date-updated' } },
  } };
  assert.deepEqual(historyRestoreValues({ id: 'old', title: 'Original', removed: 'old', readonly: 'old', owner: 'old', actor: 'old', updated_at: 'old', missing: 'old' }, schema), { title: 'Original' });
});

test('history snapshots omit secret fields, binary values and entire sensitive JSON values', () => {
  const record = { id: 'one', title: 'Visible', api_key: 'private', password_field: 'private', binary: Buffer.from('private'), profile: { visible: 1, nested: [{ credential: 'private' }] }, public_json: { tags: ['one', 'two'] } };
  const fields = Object.fromEntries(Object.keys(record).map(field => [field, { type: field === 'binary' ? 'binary' : 'json' }]));
  assert.deepEqual(historySnapshot(record, { fields }), { id: 'one', title: 'Visible', public_json: { tags: ['one', 'two'] } });
});

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
const kid = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
function token(patch = {}, headerPatch = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', crv: 'Ed25519', typ: 'YUNSOFT-ENTITLEMENT+JWT', kid, ...headerPatch })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'yunsoft-commerce', productCode: 'yuncms_premium', sub: 'test-license',
    status: 'active', billingModel: 'one_time_perpetual', iat: now, nbf: now - 1, exp: null,
    allowedHosts: ['example.com', 'www.example.com'], stagingHosts: ['staging.example.com'],
    capabilities: { contentHistory: true }, ...patch })).toString('base64url');
  return `${header}.${payload}.${sign(null, Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')}`;
}

test('one distribution preserves Free capabilities without any license', () => {
  const policy = createFeaturePolicy({});
  assert.equal(policy.describe('aiAssistant').allowed, true);
  assert.equal(policy.describe('mcp').allowed, true);
  assert.equal(policy.describe('contentHistory').allowed, false);
  assert.equal(policy.licenseStatus().status, 'missing');
});

test('white-label requires an explicit signed boolean claim and administrator opt-in by default', () => {
  for (const capabilities of [{}, { whiteLabel: 'true' }, { whiteLabel: 1 }, { whiteLabel: false }]) {
    assert.equal(createFeaturePolicy({ token: token({ capabilities }), publicKey, domain: 'example.com' }).describe('whiteLabel').allowed, false);
  }
  const policy = createFeaturePolicy({ token: token({ capabilities: { whiteLabel: true } }), publicKey, domain: 'example.com' }).describe('whiteLabel');
  assert.equal(policy.allowed, true); assert.equal(policy.defaultEnabled, false);
  assert.equal(effectiveFeatureState(policy).enabled, false);
  assert.equal(effectiveFeatureState(policy).reason, 'default_disabled');
  assert.equal(effectiveFeatureState(policy, true).enabled, true);
  assert.equal(effectiveFeatureState(policy, false).enabled, false);
});

test('actual Ed25519 entitlement grants only explicit Premium capabilities and canonical allowed hosts', () => {
  const license = token();
  for (const domain of ['example.com', 'www.example.com', 'staging.example.com', 'EXAMPLE.COM']) {
    const policy = createFeaturePolicy({ token: license, publicKey, domain });
    assert.equal(policy.describe('contentHistory').allowed, true);
    assert.equal(policy.licenseStatus().status, 'active');
  }
  for (const domain of ['evil.example.com', 'example.com.evil.test', 'example.com:443', '*.example.com', 'https://example.com', '']) {
    assert.equal(verifyFeatureLicense({ token: license, publicKey, domain }).status, 'invalid');
  }
});

test('tampered signatures, algorithms, products, instances and unsupported capability types cannot unlock Premium', () => {
  const base = { publicKey, domain: 'example.com' };
  const signed = token();
  const [header, payload, signature] = signed.split('.');
  const changedPayload = Buffer.from(JSON.stringify({ capabilities: { contentHistory: true } })).toString('base64url');
  for (const value of [`${header}.${changedPayload}.${signature}`, token({}, { alg: 'none' }),
    token({ productCode: 'yunpanel_premium' }), token({ status: 'refunded' }),
    token({ activatedInstanceId: 'another-instance' }), token({ nbf: 4102444800 }), token({ exp: null, billingModel: 'monthly_term' })]) {
    const policy = createFeaturePolicy({ ...base, token: value });
    assert.equal(policy.describe('contentHistory').allowed, false);
    assert.equal(policy.describe('aiAssistant').allowed, true);
  }
  assert.equal(createFeaturePolicy({ ...base, token: token({ capabilities: { contentHistory: 'true' } }) }).describe('contentHistory').allowed, false);
});

test('expiry and operator disable cannot be reversed by an administrator feature setting', () => {
  const policy = createFeaturePolicy({ token: token(), publicKey, domain: 'example.com', disabled: ['contentHistory'] });
  assert.equal(policy.describe('contentHistory').licensed, true);
  assert.equal(policy.describe('contentHistory').ownerDisabled, true);
  assert.equal(policy.describe('contentHistory').allowed, false);
  const expired = createFeaturePolicy({ token: token({ exp: 1 }), publicKey, domain: 'example.com' });
  assert.equal(expired.describe('contentHistory').allowed, false);
  assert.equal(expired.licenseStatus().status, 'expired');
  assert.throws(() => createFeaturePolicy({ disabled: ['typo'] }), { code: 'INVALID_FEATURE' });
});

test('monthly_term 1-month and 12-month tokens, dedicated API/staging hosts, instance binding and anti-replay replacement rules', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const monthExp = nowSec + 30 * 86400;
  const yearExp = nowSec + 365 * 86400;
  const monthly = token({
    sub: 'lic-term-1', licenseId: 'lic-term-1', billingModel: 'monthly_term', periodMonths: 1,
    entitlementVersion: 1, iat: nowSec, exp: monthExp, activatedInstanceId: 'node-prod-1',
    allowedHosts: ['example.com', 'www.example.com', 'api.example.com'],
    stagingHosts: ['staging.example.com', 'dev.example.com', 'localhost', '127.0.0.1'],
    capabilities: { contentHistory: true, whiteLabel: true },
  });
  for (const domain of ['example.com', 'www.example.com', 'api.example.com', 'staging.example.com', 'dev.example.com', 'localhost', '127.0.0.1']) {
    const policy = createFeaturePolicy({ token: `  ${monthly}\n`, publicKey, domain, instanceId: 'node-prod-1' });
    assert.equal(policy.describe('contentHistory').allowed, true);
    assert.equal(policy.describe('whiteLabel').allowed, true);
    assert.deepEqual(policy.licenseStatus(), {
      status: 'active',
      domain,
      licenseId: 'lic-term-1',
      billingModel: 'monthly_term',
      periodMonths: 1,
      expiresAt: new Date(monthExp * 1000).toISOString(),
      entitlementVersion: 1,
    });
  }
  // Missing or wrong instanceId must fail even if token is otherwise valid or expired.
  assert.equal(verifyFeatureLicense({ token: monthly, publicKey, domain: 'example.com' }).status, 'invalid');
  assert.equal(verifyFeatureLicense({ token: monthly, publicKey, domain: 'example.com', instanceId: 'node-prod-2' }).status, 'invalid');
  const expiredWrongDomain = token({ billingModel: 'monthly_term', periodMonths: 1, exp: nowSec - 60, allowedHosts: ['other.example.com'], stagingHosts: [] });
  assert.equal(verifyFeatureLicense({ token: expiredWrongDomain, publicKey, domain: 'example.com' }).status, 'invalid');
  assert.equal(verifyFeatureLicense({ token: token({ exp: 'not-an-integer' }), publicKey, domain: 'example.com' }).status, 'invalid');
  assert.equal(verifyFeatureLicense({ token: token({ periodMonths: 12 }), publicKey, domain: 'example.com' }).status, 'invalid');
  assert.equal(verifyFeatureLicense({ token: token({ billingModel: 'monthly_term', periodMonths: 0, exp: monthExp }), publicKey, domain: 'example.com' }).status, 'invalid');
  assert.equal(verifyFeatureLicense({ token: token({ entitlementVersion: 0 }), publicKey, domain: 'example.com' }).status, 'invalid');
  assert.equal(verifyFeatureLicense({ token: token({ status: 'expired', billingModel: 'monthly_term', periodMonths: 1, exp: nowSec - 5 }), publicKey, domain: 'example.com' }).status, 'expired');

  const annualRenewal = token({
    sub: 'lic-term-1', licenseId: 'lic-term-1', billingModel: 'monthly_term', periodMonths: 12,
    entitlementVersion: 2, iat: nowSec + 5, exp: yearExp, activatedInstanceId: 'node-prod-1',
    allowedHosts: ['example.com', 'www.example.com', 'api.example.com'],
    capabilities: { contentHistory: true, whiteLabel: true },
  });
  const initialPolicy = createFeaturePolicy({ publicKey, domain: 'example.com', instanceId: 'node-prod-1' });
  assert.equal(initialPolicy.canReplaceWith(monthly), true);
  const v1Policy = initialPolicy.withToken(monthly);
  assert.equal(v1Policy.canReplaceWith(monthly), true);
  assert.equal(v1Policy.canReplaceWith(annualRenewal), true);
  const v2Policy = initialPolicy.withToken(annualRenewal);
  assert.equal(v2Policy.licenseStatus().periodMonths, 12);
  assert.equal(v2Policy.licenseStatus().entitlementVersion, 2);
  // Stale v1 token replay over active v2 renewal is rejected.
  assert.equal(v2Policy.canReplaceWith(monthly), false);
  // Earlier iat / shorter expiry for same version is rejected.
  const sameVersionOlder = token({
    sub: 'lic-term-1', licenseId: 'lic-term-1', billingModel: 'monthly_term', periodMonths: 1,
    entitlementVersion: 2, iat: nowSec, exp: monthExp, activatedInstanceId: 'node-prod-1',
  });
  assert.equal(v2Policy.canReplaceWith(sameVersionOlder), false);
});

test('revision parsing preserves full unsigned BIGINT and rejects ambiguous or unsafe values', () => {
  for (const value of [0, 1, '0', '9007199254740993', '18446744073709551615']) assert.equal(parseItemRevision(value), String(value));
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '01', '-1', '1e2', '18446744073709551616', {}, []]) {
    assert.throws(() => parseItemRevision(value), { code: 'INVALID_ITEM_REVISION' });
  }
  assertItemRevision(null, '2');
  assertItemRevision('2', '2');
  assert.throws(() => assertItemRevision('1', '2'), { code: 'ITEM_REVISION_CONFLICT' });
  assert.deepEqual(contentTracking({ metadata: { contentTracking: { enabled: true, history: true } } }), { tracked: true, enabled: true, history: true });
});

test('tracked bulk mutations target only their locked keys even under read committed isolation', () => {
  const key = "unsafe' OR 1=1 --";
  const result = restrictMutationToKeys({ sql: ' WHERE `status` = ?', params: ['draft'] }, 'id', [key, 'other']);
  assert.equal(result.sql, ' WHERE `status` = ? AND `id` IN (?, ?)');
  assert.deepEqual(result.params, ['draft', key, 'other']);
  assert.equal(restrictMutationToKeys({ sql: '', params: [] }, 'id', []).sql, ' WHERE 1 = 0');
  assert.throws(() => restrictMutationToKeys({ sql: '', params: [] }, 'id;DELETE', ['key']));
});

test('license configuration defaults to official Yunsoft public trust anchor, resolves non-local public URLs safely and preserves explicit overrides', () => {
  const officialKey = createPublicKey(OFFICIAL_LICENSE_PUBLIC_KEY);
  assert.equal(officialKey.asymmetricKeyType, 'ed25519');
  const computedKid = createHash('sha256').update(officialKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  assert.equal(computedKid, OFFICIAL_LICENSE_KEY_ID);
  assert.equal(OFFICIAL_LICENSE_KEY_ID, '1cbcc4d3173d0c15');

  // Default localhost configuration keeps domain null so stagingHosts (localhost/127.0.0.1) never unlock an unconfigured server.
  assert.deepEqual(loadConfig({}).features, { token: null, publicKey: null, domain: null, instanceId: null, disabled: [] });
  for (const localUrl of [
    'http://localhost:3008',
    'http://127.0.0.1:3008',
    'http://0.0.0.0:3008',
    'http://[::1]:3008',
    'http://192.168.1.20:3008',
    'http://app.localhost:3008',
    'http://cms.local:3008',
    'http://mysql:3008',
    'https://user:pass@cms.example.com',
    'https://cms.example.com?override=1',
  ]) {
    assert.equal(resolveLicenseDomain({ AUTH_PUBLIC_URL: localUrl, STUDIO_ORIGIN: localUrl }), null);
  }

  // Real non-local public origins resolve installation domain automatically without YUNCMS_LICENSE_DOMAIN.
  assert.equal(loadConfig({ AUTH_PUBLIC_URL: 'https://cms.example.com' }).features.domain, 'cms.example.com');
  assert.equal(loadConfig({ AUTH_PUBLIC_URL: 'http://localhost:3008', STUDIO_ORIGIN: 'https://studio.example.com:8443' }).features.domain, 'studio.example.com');
  assert.equal(loadConfig({ YUNCMS_PUBLIC_URL: 'https://münchen.de' }).features.domain, 'xn--mnchen-3ya.de');
  assert.deepEqual(createFeaturePolicy({ AUTH_PUBLIC_URL: 'https://cms.example.com' }).licenseStatus(), {
    status: 'missing',
    configuredDomain: 'cms.example.com',
  });

  // Explicit YUNCMS_LICENSE_DOMAIN and YUNCMS_LICENSE_PUBLIC_KEY overrides retain strict precedence and fail closed when invalid.
  const features = loadConfig({
    AUTH_PUBLIC_URL: 'https://cms.example.com',
    YUNCMS_LICENSE_TOKEN: 'signed',
    YUNCMS_LICENSE_PUBLIC_KEY: 'public',
    YUNCMS_LICENSE_DOMAIN: 'example.test',
    YUNCMS_LICENSE_INSTANCE_ID: 'instance',
    YUNCMS_FEATURES_DISABLED: 'mcp, flowScripts',
  }).features;
  assert.deepEqual(features, { token: 'signed', publicKey: 'public', domain: 'example.test', instanceId: 'instance', disabled: ['mcp', 'flowScripts'] });

  const invalidDomainOverride = createFeaturePolicy({ AUTH_PUBLIC_URL: 'https://example.com', YUNCMS_LICENSE_DOMAIN: 'https://bad:443', publicKey, token: token() });
  assert.equal(invalidDomainOverride.licenseStatus().status, 'invalid');

  // Default trust anchor rejects tokens signed by untrusted keys even if header.kid spoofs 1cbcc4d3173d0c15.
  const spoofedKidToken = token({}, { kid: OFFICIAL_LICENSE_KEY_ID });
  assert.equal(verifyFeatureLicense({ token: spoofedKidToken, domain: 'example.com' }).status, 'invalid');
  assert.equal(verifyFeatureLicense({ token: spoofedKidToken, publicKey: '', domain: 'example.com' }).status, 'invalid');
  assert.equal(verifyFeatureLicense({ token: token(), publicKey: 'invalid-pem', domain: 'example.com' }).status, 'invalid');
});
