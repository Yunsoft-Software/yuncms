import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const builderSource = readFileSync(resolve(SRC, 'components/RuleBuilder.jsx'), 'utf8');
const rolesSource = readFileSync(resolve(SRC, 'screens/RolesPermissionsScreen.jsx'), 'utf8');
const builderCss = readFileSync(resolve(SRC, 'rule-builder.css'), 'utf8');

test('RuleBuilder only visualizes simple single clauses and AND groups', () => {
  assert.match(builderSource, /function simpleClauseFromObject/);
  assert.match(builderSource, /Array\.isArray\(clauses\)/);
  assert.match(builderSource, /Object\.keys\(parsed\)\.length === 1/);
  assert.match(builderSource, /return \{ compatible: false, rules: \[\], error: '' \}/);
  assert.match(builderSource, /forceRaw = !parsed\.compatible/);
  assert.match(builderSource, /value=\{value\}/);
});

test('visual rules serialize back into the same permission JSON contract', () => {
  assert.match(builderSource, /export function rulesToFilter/);
  assert.match(builderSource, /clauses\.length === 1 \? clauses\[0\] : \{ _and: clauses \}/);
  assert.match(rolesSource, /const filter = parseJsonInput\(advancedForm\.filter\)/);
  assert.match(rolesSource, /const validation = supportsValidation\(advancedPermission\.action\)/);
  assert.match(rolesSource, /fields: advancedForm\.allFields \? null : advancedForm\.fields/);
  assert.match(rolesSource, /filter,/);
  assert.match(rolesSource, /validation,/);
});

test('row filters and validation reuse the same shared RuleBuilder', () => {
  const matches = rolesSource.match(/<RuleBuilder/g) || [];
  assert.equal(matches.length, 2);
  assert.match(rolesSource, /value=\{advancedForm\.filter\}/);
  assert.match(rolesSource, /value=\{advancedForm\.validation\}/);
  assert.match(rolesSource, /disabled=\{!supportsValidation\(route\.action\)\}/);
  assert.match(builderCss, /\.permission-rule-builder-stack/);
  assert.match(builderCss, /\.rule-builder-raw textarea/);
});
