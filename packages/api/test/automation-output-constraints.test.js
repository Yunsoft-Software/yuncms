import assert from 'node:assert/strict';
import test from 'node:test';
import { automationFromRow, normalizeAutomation } from '../src/automations/config.js';
import { buildOutputContract, enforceOutputConstraints, normalizeOutputConstraints, validateConstraintDefinitions } from '../src/automations/output-constraints.js';
import { automationResponseFormat, providerAdmissionEstimate } from '../src/ai/service.js';
import { errorBody, statusForError } from '../src/error-response.js';
import { normalizeAiSettingsPatch } from '../src/ai/config.js';

const rule = { name: 'Exact text', collection: 'records', run_as: 'ordinary-user', instruction: 'Copy the selected input.',
  input_fields: ['source'], output_fields: ['summary'], output_constraints: { summary: { must_equal_input: 'source' } } };
const collection = { fields: { source: { type: 'text' }, summary: { type: 'text' }, category: { type: 'string', required: true } } };

test('constraints are explicit, bounded and confined to configured input/output fields', () => {
  assert.deepEqual(normalizeAutomation({ ...rule, output_constraints: undefined }).output_constraints, {});
  assert.deepEqual(normalizeAutomation(rule).output_constraints, rule.output_constraints);
  for (const output_constraints of [null, [], 'source', false, { hidden: { must_equal_input: 'source' } },
    { summary: { must_equal_input: 'hidden' } }, { summary: 'source' },
    { summary: { must_equal_input: 'source', repair: true } }, { summary: { must_equal_input: ['source'] } },
    JSON.parse('{"__proto__":{"must_equal_input":"source"}}')]) {
    assert.throws(() => normalizeAutomation({ ...rule, output_constraints }), { code: 'INVALID_AUTOMATION' });
  }
  const source = normalizeOutputConstraints(rule.output_constraints, rule.input_fields, rule.output_fields);
  source.summary.must_equal_input = 'changed';
  assert.equal(rule.output_constraints.summary.must_equal_input, 'source');
});

test('legacy persisted rows expose an empty map; stored maps are parsed without dropping constraints', () => {
  const row = { ...rule, input_fields: JSON.stringify(rule.input_fields), output_fields: JSON.stringify(rule.output_fields) };
  assert.deepEqual(automationFromRow({ ...row, output_constraints: null }).output_constraints, {});
  assert.deepEqual(automationFromRow({ ...row, output_constraints: JSON.stringify(rule.output_constraints) }).output_constraints, rule.output_constraints);
  assert.throws(() => automationFromRow({ ...row, output_constraints: '{broken' }), SyntaxError);
});

test('only text/string equality is admitted, and arbitrary JSON outputs are not silently restricted by a strict schema', () => {
  assert.deepEqual(validateConstraintDefinitions(rule, collection), rule.output_constraints);
  for (const field of ['source', 'summary']) {
    assert.throws(() => validateConstraintDefinitions(rule, { fields: { ...collection.fields, [field]: { type: 'integer' } } }), { code: 'INVALID_AUTOMATION' });
  }
  assert.throws(() => validateConstraintDefinitions({ ...rule, output_fields: ['summary', 'payload'] },
    { fields: { ...collection.fields, payload: { type: 'json' } } }), { code: 'INVALID_AUTOMATION' });
});

test('strict schema enums and server guards use the same exact source snapshot without normalization', () => {
  for (const source of ['native-json-value', ' leading and trailing ', 'Türkçe 日本語 🙂\nnext', '', null]) {
    const contract = buildOutputContract(rule, { source }, collection);
    assert.deepEqual(contract.schema.properties.summary.enum, [source]);
    assert.deepEqual(contract.schema.required, ['summary']);
    assert.equal(contract.schema.additionalProperties, false);
    assert.equal(Object.isFrozen(contract.expected), true);
    const value = { summary: source };
    assert.equal(enforceOutputConstraints(value, contract.expected), value);
    assert.equal(enforceOutputConstraints({ summary: 'anything' }, {} ).summary, 'anything');
  }
  const contract = buildOutputContract(rule, { source: 'native-json-value' }, collection);
  for (const output of [{ summary: 'native--value' }, { summary: 'NATIVE-JSON-VALUE' }, { summary: null }, {}, null]) {
    assert.throws(() => enforceOutputConstraints(output, contract.expected), error => {
      assert.equal(error.code, 'AI_OUTPUT_CONSTRAINT_FAILED'); assert.equal(error.path, 'summary');
      assert.equal(statusForError(error), 400);
      assert.equal(JSON.stringify(errorBody(error, 'request')).includes('native-json-value'), false);
      return true;
    });
  }
});

test('missing, mistyped, oversized and null-to-required source snapshots fail before provider work', () => {
  for (const input of [{}, { source: 0 }, { source: false }, { source: {} }, { source: 'x'.repeat(50_001) }]) {
    assert.throws(() => buildOutputContract(rule, input, collection), { code: 'AI_OUTPUT_CONSTRAINT_INPUT_INVALID' });
  }
  assert.throws(() => buildOutputContract(rule, { source: null }, { fields: { ...collection.fields, summary: { type: 'text', required: true } } }),
    { code: 'AI_OUTPUT_CONSTRAINT_INPUT_INVALID' });
  assert.throws(() => buildOutputContract({ ...rule, output_fields: ['summary', 'category'],
    output_constraints: { ...rule.output_constraints, category: { must_equal_input: 'source' } } },
  { source: '日'.repeat(9000) }, collection), { code: 'AI_OUTPUT_CONSTRAINT_INPUT_INVALID' });
});

test('non-bound scalar outputs retain their native types; schemas do not mutate the rule or input', () => {
  const input = { source: 'snapshot' }, expanded = { ...rule, output_fields: ['summary', 'category', 'count', 'active', 'amount'] };
  const contract = buildOutputContract(expanded, input, { fields: { ...collection.fields,
    count: { type: 'integer' }, active: { type: 'boolean', required: true }, amount: { type: 'decimal' } } });
  assert.deepEqual(contract.schema.properties.count.type, ['integer', 'null']);
  assert.equal(contract.schema.properties.active.type, 'boolean');
  assert.deepEqual(contract.schema.properties.amount.type, ['number', 'string', 'null']);
  input.source = 'later'; assert.equal(contract.expected.summary, 'snapshot');
  assert.equal(Object.hasOwn(rule, 'outputSchema'), false);
});

test('legacy generation remains JSON object mode; declared constraints request strict schema with no text fallback', () => {
  assert.deepEqual(automationResponseFormat(), { type: 'json_object' });
  const { schema } = buildOutputContract(rule, { source: 'snapshot' }, collection);
  assert.deepEqual(automationResponseFormat(schema), { type: 'json_schema', json_schema: { name: 'yuncms_automation_output', strict: true, schema } });
  assert.throws(() => normalizeAiSettingsPatch({ provider_observations_enabled: true }), { code: 'INVALID_AI_CONFIG' });
});

test('final native results must preserve the bound input snapshot as well as its output', () => {
  const expected = { summary: 'snapshot' };
  assert.equal(enforceOutputConstraints({ summary: 'snapshot', source: 'snapshot' }, expected, rule.output_constraints).source, 'snapshot');
  for (const result of [{ summary: 'snapshot', source: 'changed by a filter' }, { summary: 'snapshot' }]) {
    assert.throws(() => enforceOutputConstraints(result, expected, rule.output_constraints), { code: 'AI_OUTPUT_CONSTRAINT_FAILED', path: 'summary' });
  }
});

test('native capacity reservations include the actual dynamic schema, preserving the legacy estimate otherwise', () => {
  const messages = [{ role: 'user', content: 'input' }], tools = [], config = { maxOutputTokens: 1500 };
  const legacy = Buffer.byteLength(JSON.stringify(messages) + JSON.stringify(tools), 'utf8') + 1500 + 1024;
  assert.equal(providerAdmissionEstimate(messages, tools, config, automationResponseFormat()), legacy);
  const format = automationResponseFormat(buildOutputContract(rule, { source: '日本語'.repeat(100) }, collection).schema);
  assert.equal(providerAdmissionEstimate(messages, tools, config, format), legacy + Buffer.byteLength(JSON.stringify(format), 'utf8'));
});
