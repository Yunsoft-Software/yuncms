import { randomUUID } from 'node:crypto';
import { quoteIdentifier, withTransaction, withFlowEvents } from '@yunsoft/yuncms-core';
import { AiAutomationsService } from '../automations/service.js';
import { AI_AUTOMATION_ORIGIN, automationError, normalizeAutomation, recordFingerprint } from '../automations/config.js';
import { enforceOutputConstraints } from '../automations/output-constraints.js';

export function normalizeAiFlowOperation(options, accountability) {
  if (!accountability?.user || accountability.admin || accountability.public || accountability.system) {
    throw automationError('AI_FLOW_ACTOR_REQUIRED', 'AI operations require an active normal execution user');
  }
  const allowed = ['collection', 'ids', 'input_fields', 'output_fields', 'output_constraints', 'instruction', 'require_changed_inputs'];
  if (!options || Object.keys(options).some(key => !allowed.includes(key))
    || (options.require_changed_inputs !== undefined && typeof options.require_changed_inputs !== 'boolean')) {
    throw automationError('INVALID_AUTOMATION', 'Unsupported AI operation options');
  }
  const ids = Array.isArray(options.ids) ? options.ids : [options.ids];
  if (!ids.length || ids.length > 10 || ids.some(id => !['string', 'number'].includes(typeof id) || !String(id) || String(id).length > 191)
    || new Set(ids.map(String)).size !== ids.length) throw automationError('INVALID_AUTOMATION', 'AI operations require 1–10 distinct record keys');
  const rule = normalizeAutomation({ name: 'Flow AI operation', run_as: accountability.user,
    collection: options.collection, instruction: options.instruction, input_fields: options.input_fields,
    output_fields: options.output_fields, output_constraints: options.output_constraints });
  return { rule, ids: ids.map(String) };
}

export function createAiFlowOperation({ assistant, settingsStore, schemaCache }) {
  return async (options, context) => withFlowEvents(false, async () => {
    if (context.flow.trigger === 'event' && context.flow.options.mode === 'filter') {
      throw automationError('AI_FLOW_FILTER_FORBIDDEN', 'Use an after-commit action for AI operations');
    }
    const { rule, ids } = normalizeAiFlowOperation(options, context.accountability);
    if (options.require_changed_inputs && context.data.$trigger.event === 'items.update'
      && !rule.input_fields.some(field => Object.hasOwn(context.data.$trigger.payload?.changes ?? {}, field))) return [];
    const service = new AiAutomationsService({ ...context, assistant, settingsStore, schemaCache });
    const check = async (database = context.database) => {
      context.signal.throwIfAborted();
      await context.assertFeature?.('aiFlows', { database });
      const settings = await settingsStore.readRuntime();
      if (!settings.enabled || !settings.writesEnabled) throw automationError('AI_WRITES_DISABLED', 'Enable AI writes before running AI operations');
    };
    const results = [];
    for (const id of ids) {
      await check();
      const { record, output, outputConstraints } = await service.generate(rule, id, context.database, { signal: context.signal });
      const fields = [...rule.input_fields, ...rule.output_fields];
      const fingerprint = recordFingerprint(record, fields), actions = [];
      const result = await withTransaction(context.database, async database => {
        await check(database);
        const [[currentFlow]] = await database.query('SELECT status, revision FROM yuncms_flows WHERE id = ? FOR UPDATE', [context.flow.id]);
        if (!currentFlow || currentFlow.status !== 'active' || currentFlow.revision !== context.flow.revision) throw automationError('AI_FLOW_CHANGED', 'Flow changed during AI generation; no output was saved');
        const execution = await service.executionOptions(rule, database);
        const schema = execution.schema.collections[rule.collection];
        await database.query(`SELECT ${quoteIdentifier(schema.primary_key)} FROM ${quoteIdentifier(schema.collection)} WHERE ${quoteIdentifier(schema.primary_key)} = ? FOR UPDATE`, [id]);
        const items = new context.services.ItemsService(rule.collection, { ...execution, requestId: context.requestId ?? randomUUID(),
          emitter: context.emitter ? { filter: context.emitter.filter.bind(context.emitter), action: async (event, payload, eventContext) => { actions.push({ event, payload, context: eventContext }); } } : null });
        const current = await items.readOne(id, { fields });
        if (!current || recordFingerprint(current, fields) !== fingerprint) return { id, status: 'skipped' };
        context.signal.throwIfAborted();
        const updated = await items.updateOne(id, output);
        if (!updated) throw automationError('FORBIDDEN', 'Execution user cannot update this record');
        enforceOutputConstraints(updated, outputConstraints ?? {}, rule.output_constraints);
        context.signal.throwIfAborted();
        return { id, status: 'succeeded', output };
      });
      if (result.status === 'succeeded') for (const action of actions) {
        await context.emitter.action(action.event, action.payload, { ...action.context, [AI_AUTOMATION_ORIGIN]: true });
      }
      results.push(result);
    }
    return results;
  });
}
