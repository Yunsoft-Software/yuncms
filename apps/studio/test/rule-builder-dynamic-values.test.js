import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const component = readFileSync(resolve(import.meta.dirname, '../src/components/RuleBuilder.jsx'), 'utf8');
const css = readFileSync(resolve(import.meta.dirname, '../src/rule-builder.css'), 'utf8');

test('visual permission rules expose the supported request-context values', () => {
  for (const value of ['$CURRENT_USER', '$CURRENT_ROLE', '$NOW', '$NOW(-1 day)', '$NOW(+1 day)']) {
    assert.match(component, new RegExp(value.replace(/[+$()]/g, '\\$&')));
  }
  assert.match(component, /rule-builder-dynamic-select/);
  assert.match(component, /dynamicValue \? 'text' : inputType\(type\)/);
  assert.match(css, /\.rule-builder-value-control\.dynamic input/);
});

test('dynamic values bypass static boolean and numeric coercion', () => {
  const dynamicGuard = component.indexOf("typeof value === 'string'");
  const booleanCoercion = component.indexOf("type === 'boolean'");
  assert.ok(dynamicGuard > -1 && dynamicGuard < booleanCoercion);
});
