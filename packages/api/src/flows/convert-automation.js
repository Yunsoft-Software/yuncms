import { FlowsService, withTransaction } from '@yunsoft/yuncms-core';
import { automationError } from '../automations/config.js';

export function automationFlowDefinition(rule) {
  const events = [rule.on_create && 'items.create', rule.on_update && 'items.update'].filter(Boolean);
  return { name: rule.name, description: 'AI content automation', status: 'inactive', trigger: 'event',
    accountability: 'user', run_as: rule.run_as, options: { mode: 'action', events, collections: [rule.collection] }, entry: 'generate',
    operations: [{ id: 'generate', key: 'generate', name: rule.name, type: 'ai', position: { x: 380, y: 100 }, resolve: null, reject: null,
      options: { collection: rule.collection, ids: '{{ $trigger.payload.key }}', input_fields: rule.input_fields,
        output_fields: rule.output_fields, output_constraints: rule.output_constraints, instruction: rule.instruction, require_changed_inputs: true } }] };
}

export async function convertAutomationToFlow(service, id, flowOptions = {}) {
  service.requireAdministrator();
  return withTransaction(service.database, async database => {
    const rule = await service.read(id, database, { lock: true });
    if (!rule) throw automationError('NOT_FOUND', 'Automation not found');
    const flows = new FlowsService({ ...service, database, ...flowOptions });
    if (rule.flow_id) return flows.readOne(rule.flow_id);
    await service.executionOptions(rule, database);
    const flow = await flows.save(automationFlowDefinition(rule));
    await database.query('UPDATE yuncms_ai_automations SET enabled = 0, revision = revision + 1, flow_id = ? WHERE id = ?', [flow.id, id]);
    return flow;
  });
}
