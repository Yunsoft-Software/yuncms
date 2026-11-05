import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { emptyAutomation, editableAutomation, setAutomationConstraint, toggleAutomationField } from '../src/automation-form.js';
import { AUTOMATION_LOCALES } from '../src/locales/automations.js';
import { readStudioRoute, studioPath } from '../src/studio-route.js';

test('automation form strips server properties and keeps inputs and outputs disjoint', () => {
  const draft = { ...emptyAutomation(), input_fields: ['message'] };
  const moved = toggleAutomationField(draft, 'output_fields', 'message');
  assert.deepEqual(moved.input_fields, []); assert.deepEqual(moved.output_fields, ['message']);
  assert.equal(emptyAutomation().enabled, false);
  assert.deepEqual(editableAutomation({ ...draft, id: 'server-id', revision: 2 }), draft);
});

test('explicit equality bindings round-trip and cannot disappear when their fields move', () => {
  const draft = { ...emptyAutomation(), input_fields: ['source'], output_fields: ['summary'] };
  const bound = setAutomationConstraint(draft, 'summary', 'source');
  assert.deepEqual(bound.output_constraints, { summary: { must_equal_input: 'source' } });
  const editable = editableAutomation({ ...bound, id: 'server-id' });
  assert.deepEqual(editable, bound); editable.output_constraints.summary.must_equal_input = 'other';
  assert.equal(bound.output_constraints.summary.must_equal_input, 'source');
  for (const [key, field] of [['input_fields', 'source'], ['output_fields', 'summary'], ['output_fields', 'source']]) {
    assert.throws(() => toggleAutomationField(bound, key, field), { code: 'AUTOMATION_CONSTRAINT_FIELD_IN_USE' });
  }
  assert.deepEqual(setAutomationConstraint(bound, 'summary', '').output_constraints, {});
  const component = readFileSync(new URL('../src/components/AutomationOutputConstraints.jsx', import.meta.url), 'utf8');
  assert.match(component, /must_equal_input/); assert.doesNotMatch(component, /style=|window\.(alert|prompt)/);
});

test('legacy route leads to Flows and AI forms retain read-only preview and guarded conversion', () => {
  assert.equal(readStudioRoute(studioPath.automations()).section, 'flows');
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /id: 'automations'/);
  const source = readFileSync(new URL('../src/components/FlowAiOperation.jsx', import.meta.url), 'utf8');
  const legacy = readFileSync(new URL('../src/components/FlowLegacyAutomations.jsx', import.meta.url), 'utf8');
  assert.match(source, /\/automations\/preview/);
  assert.match(source, /Object.keys\(options.output_constraints/);
  assert.match(legacy, /useConfirmDialog/); assert.match(legacy, /convert-to-flow/);
  assert.doesNotMatch(source + legacy, /window\.(alert|prompt|confirm)/);
});

test('all eight languages cover automation statuses, instructions and support CTAs', () => {
  const keys = Object.keys(AUTOMATION_LOCALES.en).sort();
  assert.equal(Object.keys(AUTOMATION_LOCALES).length, 8);
  for (const dictionary of Object.values(AUTOMATION_LOCALES)) assert.deepEqual(Object.keys(dictionary).sort(), keys);
});

test('official Community support branding is not dismissible and footer links remain limited to administrators', () => {
  const card = readFileSync(new URL('../src/components/YunsoftSupportCard.jsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(card, /support-dismissed|localStorage|setDismissed/);
  assert.match(card, /settings\.white_label_enabled/);
  assert.match(card, /rel="noopener noreferrer"/);
  assert.match(card, /utm_campaign.*yuncms-services/);
  assert.match(card, /YUNCMS_SPONSORS = 'https:\/\/github\.com\/sponsors\/Yunsoft-Software'/);
  assert.match(card, /href=\{YUNCMS_SPONSORS\}/);
  assert.match(app, /session\?\.user\?\.admin === true && !navigationCollapsed && <div className="sidebar-support-links"><YunsoftSupportLinks/);
  const css = readFileSync(new URL('../src/automations.css', import.meta.url), 'utf8');
  const tokens = readFileSync(new URL('../src/appearance.css', import.meta.url), 'utf8');
  for (const [, token] of css.matchAll(/var\((--studio-[\w-]+)\)/g)) assert.ok(tokens.includes(`${token}:`), `${token} exists in both themes`);
  assert.match(css, /\.sidebar-support-links \.yunsoft-support-links/);
});
