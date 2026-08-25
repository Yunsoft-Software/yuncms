import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { normalizeStudioSettings } from '../src/studio-settings.js';

const appearanceSource = await readFile(new URL('../src/screens/AppearanceScreen.jsx', import.meta.url), 'utf8');
const loginSource = await readFile(new URL('../src/screens/LoginScreen.jsx', import.meta.url), 'utf8');
const panelSource = await readFile(new URL('../src/components/PublicRegistrationSettings.jsx', import.meta.url), 'utf8');

test('public registration defaults closed and only accepts an explicit true flag', () => {
  assert.equal(normalizeStudioSettings({}).public_registration_enabled, false);
  assert.equal(normalizeStudioSettings({ public_registration_enabled: 1 }).public_registration_enabled, false);
  assert.equal(normalizeStudioSettings({ public_registration_enabled: true }).public_registration_enabled, true);
});

test('Studio settings and login source wire the guarded public registration flow', () => {
  assert.match(appearanceSource, /PublicRegistrationSettings/);
  assert.match(panelSource, /\/studio-settings\/admin/);
  assert.match(panelSource, /!entry\.admin && !entry\.public/);
  assert.match(panelSource, /public_registration_enabled/);
  assert.match(panelSource, /public_registration_role/);
  assert.match(loginSource, /settings\.public_registration_enabled === true/);
  assert.match(loginSource, /\/auth\/register/);
  assert.match(loginSource, /registerMode/);
  assert.match(loginSource, /auth\.confirmPassword/);
});
