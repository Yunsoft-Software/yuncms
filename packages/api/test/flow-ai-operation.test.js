import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAiFlowOperation } from '../src/flows/ai-operation.js';
import { automationFlowDefinition } from '../src/flows/convert-automation.js';
import { aiFlowConversionMigration } from '../../core/src/migrations/0028-ai-flow-conversion.js';
const actor = { user: 'normal-user', admin: false, public: false, system: false };
const options = { collection: 'articles', ids: ['record-1'], input_fields: ['body'], output_fields: ['summary'], instruction: 'Summarize', output_constraints: {} };
test('AI Flow operation preserves bounded records, field allowlists and explicit normal accountability', () => {
  assert.deepEqual(normalizeAiFlowOperation(options, actor).ids, ['record-1']);
  for (const invalid of [null, { user: 'owner', admin: true }, { user: 'system', system: true }, { public: true }]) assert.throws(() => normalizeAiFlowOperation(options, invalid), { code: 'AI_FLOW_ACTOR_REQUIRED' });
  for (const patch of [{ ids: [] }, { ids: Array.from({ length: 11 }, (_, i) => String(i)) }, { ids: ['x', 'x'] }, { ids: [{}] }, { run_as: 'owner' }, { output_fields: ['body'] }]) assert.throws(() => normalizeAiFlowOperation({ ...options, ...patch }, actor), { code: 'INVALID_AUTOMATION' });
});
test('conversion preserves triggers, execution actor, instructions and output constraints while starting inactive', () => {
  const rule = { ...options, name: 'Summary', run_as: actor.user, on_create: true, on_update: true, output_constraints: { summary: { must_equal_input: 'body' } } };
  const flow = automationFlowDefinition(rule);
  assert.equal(flow.status, 'inactive'); assert.equal(flow.run_as, actor.user); assert.equal(flow.accountability, 'user');
  assert.deepEqual(flow.options.events, ['items.create', 'items.update']); assert.deepEqual(flow.operations[0].options.output_constraints, rule.output_constraints);
  assert.equal(flow.operations[0].options.require_changed_inputs, true);
  assert.match(aiFlowConversionMigration.statements.join(' '), /ADD COLUMN flow_id CHAR\(36\) NULL/);
  assert.doesNotMatch(aiFlowConversionMigration.statements.join(' '), /DELETE FROM|DROP TABLE/i);
});
