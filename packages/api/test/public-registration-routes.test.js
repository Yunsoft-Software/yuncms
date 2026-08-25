import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const authRouteSource = await readFile(new URL('../src/routes/auth.js', import.meta.url), 'utf8');
const settingsRouteSource = await readFile(new URL('../src/routes/studio-settings.js', import.meta.url), 'utf8');

test('public registration is rate limited through the auth action limiter', () => {
  assert.match(authRouteSource, /router\.post\('\/register', actionLimit/);
  assert.match(authRouteSource, /registerPublic\(req\.body \?\? \{\}\)/);
  assert.match(authRouteSource, /res\.status\(201\)/);
});

test('registration email verification uses the existing auth token and mail flow when enabled', () => {
  assert.match(authRouteSource, /public_registration_require_email_verification/);
  assert.match(authRouteSource, /systemAuthTokensService\(req\)\.createEmailVerification\(data\.id\)/);
  assert.match(authRouteSource, /verificationMessage\(config, result\.token\)/);
  assert.match(authRouteSource, /email_verification_required: verificationRequired/);
  assert.match(authRouteSource, /router\.post\('\/email-verification\/request', actionLimit/);
  assert.match(authRouteSource, /requestEmailVerification\(req\.body\?\.email\)/);
});

test('registration role configuration is available only from the managed settings endpoint', () => {
  assert.match(settingsRouteSource, /router\.get\('\/admin'/);
  assert.match(settingsRouteSource, /readOne\(\)/);
  assert.match(settingsRouteSource, /router\.get\('\/'/);
  assert.match(settingsRouteSource, /readPublic\(\)/);
});
