import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { emptyAutomation, editableAutomation, toggleAutomationField } from '../src/automation-form.js';
import { AUTOMATION_LOCALES } from '../src/locales/automations.js';
import { readStudioRoute, studioPath } from '../src/studio-route.js';

test('automation form strips server properties and keeps inputs and outputs disjoint', () => {
  const draft = { ...emptyAutomation(), input_fields: ['message'] };
  const moved = toggleAutomationField(draft, 'output_fields', 'message');
  assert.deepEqual(moved.input_fields, []); assert.deepEqual(moved.output_fields, ['message']);
  assert.equal(emptyAutomation().enabled, false);
  assert.deepEqual(editableAutomation({ ...draft, id: 'server-id', revision: 2 }), draft);
});

test('automation route, administrator boundaries, preview and reusable confirmation wiring are present', () => {
  assert.equal(readStudioRoute(studioPath.automations()).section, 'automations');
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /id: 'automations'.*adminOnly: true/);
  assert.match(app, /section === 'automations'\) return session\?\.user\?\.admin/);
  const source = readFileSync(new URL('../src/screens/AutomationsScreen.jsx', import.meta.url), 'utf8');
  assert.match(source, /useConfirmDialog/); assert.match(source, /\/automations\/preview/);
  assert.match(source, /run.status === 'failed' && selectedRule\?\.enabled && run.revision === selectedRule.revision/);
  assert.doesNotMatch(source, /window\.(alert|prompt|confirm)/);
});

test('all eight languages cover automation statuses, instructions and support CTAs', () => {
  const keys = Object.keys(AUTOMATION_LOCALES.en).sort();
  assert.equal(Object.keys(AUTOMATION_LOCALES).length, 8);
  for (const dictionary of Object.values(AUTOMATION_LOCALES)) assert.deepEqual(Object.keys(dictionary).sort(), keys);
});

test('support card can be dismissed and the footer links are limited to administrators', () => {
  const card = readFileSync(new URL('../src/components/YunsoftSupportCard.jsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(card, /localStorage\.setItem\('yuncms.support-dismissed', '1'\)/);
  assert.match(card, /aria-label=\{t\('common.close'\)\}/);
  assert.match(card, /rel="noopener noreferrer"/);
  assert.match(card, /utm_campaign.*yuncms-sponsorship.*yuncms-services/);
  assert.match(app, /session\?\.user\?\.admin === true && !navigationCollapsed && <div className="sidebar-support-links"><YunsoftSupportLinks/);
  const css = readFileSync(new URL('../src/automations.css', import.meta.url), 'utf8');
  const tokens = readFileSync(new URL('../src/appearance.css', import.meta.url), 'utf8');
  for (const [, token] of css.matchAll(/var\((--studio-[\w-]+)\)/g)) assert.ok(tokens.includes(`${token}:`), `${token} exists in both themes`);
  assert.match(css, /\.sidebar-support-links \.yunsoft-support-links/);
});
