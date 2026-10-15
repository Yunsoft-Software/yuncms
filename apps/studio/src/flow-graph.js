export const FLOW_OPERATION_DEFAULTS = Object.freeze({
  script: { format: 'module', code: 'export default async function (data, context) {\n  return { value: data.$trigger.body?.value ?? null };\n}\n' },
  transform: { value: { message: 'Hello {{ $trigger.body.name }}' } },
  condition: { rules: { '$trigger.body.approved': { _eq: true } } },
  read: { collection: '', query: { limit: 10 } },
  create: { collection: '', payload: {}, emit_events: false },
  update: { collection: '', ids: '{{ $trigger.keys }}', payload: {}, emit_events: false },
  delete: { collection: '', ids: '{{ $trigger.keys }}', emit_events: false },
  log: { message: '{{ $last }}' },
  sleep: { milliseconds: 1000 },
  request: { method: 'GET', url: 'https://api.example.com/data', headers: {} },
  mail: { to: '', subject: '', text: '' },
  trigger: { flow: '', payload: '{{ $last }}' },
  error: { code: 'FLOW_REJECTED', status: 400, message: 'The flow rejected this operation.' },
});
export function newFlowDraft() {
  return { name: '', description: '', status: 'inactive', trigger: 'manual', accountability: 'trigger', run_as: null,
    options: { response: '$last', require_confirmation: true }, entry: null, operations: [] };
}
export function triggerDefaults(type) {
  if (type === 'event') return { mode: 'action', events: ['items.create'], collections: [] };
  if (type === 'webhook') return { method: 'POST', public: false, response: '$last' };
  if (type === 'schedule') return { cron: '0 */5 * * * *', response: '$last' };
  if (type === 'operation') return { response: '$last' };
  return { response: '$last', require_confirmation: true };
}
export function exportFlowDefinition(flow) {
  return Object.fromEntries(['name', 'description', 'status', 'trigger', 'accountability', 'run_as', 'options', 'entry', 'operations'].map(key => [key, structuredClone(flow[key])]));
}
export function importFlowDefinition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.operations) || value.operations.length > 100) throw Error('Invalid flow definition');
  if (typeof value.name !== 'string' || !value.name.trim() || typeof value.options !== 'object' || !value.options || Array.isArray(value.options)) throw Error('Invalid flow definition');
  for (const node of value.operations) if (!node || typeof node.id !== 'string' || typeof node.name !== 'string' || typeof node.key !== 'string' || !node.options || typeof node.options !== 'object' || Array.isArray(node.options) || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) throw Error('Invalid operation definition');
  return { ...newFlowDraft(), ...exportFlowDefinition({ ...newFlowDraft(), ...value }), status: 'inactive' };
}
export function addFlowOperation(flow, type, id = crypto.randomUUID()) {
  if (!Object.hasOwn(FLOW_OPERATION_DEFAULTS, type) || flow.operations.length >= 100) throw Error('Invalid operation or operation limit reached');
  let index = flow.operations.length + 1;
  while (flow.operations.some(node => node.key === `${type}_${index}`)) index++;
  const node = { id, key: `${type}_${index}`, name: '', type, options: structuredClone(FLOW_OPERATION_DEFAULTS[type]),
    position: { x: 380 + Math.floor(flow.operations.length / 4) * 330, y: 80 + (flow.operations.length % 4) * 180 }, resolve: null, reject: null };
  node.name = node.key;
  return { ...flow, operations: [...flow.operations, node] };
}
export function removeFlowOperation(flow, id) {
  return { ...flow, entry: flow.entry === id ? null : flow.entry, operations: flow.operations.filter(node => node.id !== id)
    .map(node => ({ ...node, resolve: node.resolve === id ? null : node.resolve, reject: node.reject === id ? null : node.reject })) };
}
export function connectFlowOperation(flow, { source, target, sourceHandle = 'resolve' }) {
  if (!flow.operations.some(node => node.id === target) || !['resolve', 'reject'].includes(sourceHandle)) throw Error('Invalid connection');
  let next;
  if (source === 'trigger') next = { ...flow, entry: target };
  else {
    if (!flow.operations.some(node => node.id === source) || source === target) throw Error('Invalid connection');
    next = { ...flow, operations: flow.operations.map(node => node.id === source ? { ...node, [sourceHandle]: target } : node) };
  }
  const byId = new Map(next.operations.map(node => [node.id, node])), visiting = new Set(), seen = new Set();
  function visit(id) {
    if (!id || seen.has(id)) return;
    if (visiting.has(id)) throw Error('Circular connections are not allowed');
    visiting.add(id); const node = byId.get(id); visit(node.resolve); visit(node.reject); visiting.delete(id); seen.add(id);
  }
  for (const node of next.operations) visit(node.id);
  return next;
}
export function disconnectFlowOperation(flow, source, branch) {
  return source === 'trigger' ? { ...flow, entry: null } : { ...flow, operations: flow.operations.map(node => node.id === source ? { ...node, [branch]: null } : node) };
}
export function flowGraphEdges(flow) {
  const edges = [];
  if (flow.entry) edges.push({ id: `trigger:resolve:${flow.entry}`, source: 'trigger', target: flow.entry, sourceHandle: 'resolve', data: { branch: 'resolve' } });
  for (const node of flow.operations) for (const branch of ['resolve', 'reject']) if (node[branch]) {
    edges.push({ id: `${node.id}:${branch}:${node[branch]}`, source: node.id, target: node[branch], sourceHandle: branch, data: { branch } });
  }
  return edges;
}
export function reconcileFlowCanvasNodes(previous, model) {
  const lookup = new Map(previous.map(node => [node.id, node]));
  const nodes = model.map(node => {
    const current = lookup.get(node.id);
    // Preserve untouched references: React Flow may have observed handles before emitting measured user data.
    if (current && current.type === node.type && current.selected === node.selected && current.draggable === node.draggable
      && current.position.x === node.position.x && current.position.y === node.position.y && JSON.stringify(current.data) === JSON.stringify(node.data)) return current;
    return { ...current, ...node };
  });
  return nodes.length === previous.length && nodes.every((node, index) => node === previous[index]) ? previous : nodes;
}
