import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createFeaturePolicy, effectiveFeatureState, verifyFeatureLicense } from '../src/features.js';
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

test('license configuration defaults to Community and maps each optional server setting explicitly', () => {
  assert.deepEqual(loadConfig({}).features, { token: null, publicKey: null, domain: null, instanceId: null, disabled: [] });
  const features = loadConfig({ YUNCMS_LICENSE_TOKEN: 'signed', YUNCMS_LICENSE_PUBLIC_KEY: 'public', YUNCMS_LICENSE_DOMAIN: 'example.test', YUNCMS_LICENSE_INSTANCE_ID: 'instance', YUNCMS_FEATURES_DISABLED: 'mcp, flowScripts' }).features;
  assert.deepEqual(features, { token: 'signed', publicKey: 'public', domain: 'example.test', instanceId: 'instance', disabled: ['mcp', 'flowScripts'] });
});
