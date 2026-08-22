import assert from 'node:assert/strict';
import test from 'node:test';

import { loadExternalAuthConfig } from '../src/external-auth/config.js';

test('external auth stays disabled unless providers are explicitly configured', () => {
  const config = loadExternalAuthConfig({});
  assert.equal(config.enabled, false);
  assert.deepEqual(config.providers, []);
});

test('provider secrets are excluded from public provider metadata', () => {
  const config = loadExternalAuthConfig({
    AUTH_PROVIDERS: 'company',
    AUTH_STATE_SECRET: '0123456789abcdef0123456789abcdef',
    AUTH_PROVIDER_COMPANY_DRIVER: 'oidc',
    AUTH_PROVIDER_COMPANY_LABEL: 'Company Login',
    AUTH_PROVIDER_COMPANY_ISSUER: 'https://id.example.test',
    AUTH_PROVIDER_COMPANY_CLIENT_ID: 'client',
    AUTH_PROVIDER_COMPANY_CLIENT_SECRET: 'super-secret',
  });
  assert.deepEqual(config.publicProviders, [{ id: 'company', label: 'Company Login', driver: 'oidc' }]);
  assert.equal(JSON.stringify(config.publicProviders).includes('super-secret'), false);
});

test('ldap requires TLS unless explicitly opted into insecure transport', () => {
  assert.throws(() => loadExternalAuthConfig({
    AUTH_PROVIDERS: 'corp',
    AUTH_PROVIDER_CORP_DRIVER: 'ldap',
    AUTH_PROVIDER_CORP_URL: 'ldap://directory.example.test',
    AUTH_PROVIDER_CORP_BASE_DN: 'dc=example,dc=test',
  }), /ldaps/);
});

test('ldap uses a stable subject attribute instead of DN identity', () => {
  const config = loadExternalAuthConfig({
    AUTH_PROVIDERS: 'corp',
    AUTH_PROVIDER_CORP_DRIVER: 'ldap',
    AUTH_PROVIDER_CORP_URL: 'ldaps://directory.example.test',
    AUTH_PROVIDER_CORP_BASE_DN: 'dc=example,dc=test',
  });
  assert.equal(config.providers[0].subjectAttribute, 'entryUUID');

  const activeDirectory = loadExternalAuthConfig({
    AUTH_PROVIDERS: 'corp',
    AUTH_PROVIDER_CORP_DRIVER: 'ldap',
    AUTH_PROVIDER_CORP_URL: 'ldaps://directory.example.test',
    AUTH_PROVIDER_CORP_BASE_DN: 'dc=example,dc=test',
    AUTH_PROVIDER_CORP_SUBJECT_ATTRIBUTE: 'objectGUID',
  });
  assert.equal(activeDirectory.providers[0].subjectAttribute, 'objectGUID');
  assert.throws(() => loadExternalAuthConfig({
    AUTH_PROVIDERS: 'corp',
    AUTH_PROVIDER_CORP_DRIVER: 'ldap',
    AUTH_PROVIDER_CORP_URL: 'ldaps://directory.example.test',
    AUTH_PROVIDER_CORP_BASE_DN: 'dc=example,dc=test',
    AUTH_PROVIDER_CORP_SUBJECT_ATTRIBUTE: 'bad attribute',
  }), /subject attribute is invalid/);
});
