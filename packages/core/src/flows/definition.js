import { ExtensionError } from '@yunsoft/yuncms-extensions-sdk';

export const FLOW_LIMITS = Object.freeze({ nodes: 100, bytes: 262144, steps: 100, depth: 8, iterations: 100, durationMs: 30000 });
export const FLOW_TRIGGERS = Object.freeze(['manual', 'event', 'webhook', 'schedule', 'operation']);
export const FLOW_OPERATION_TYPES = Object.freeze(['transform', 'condition', 'read', 'create', 'update', 'delete', 'log', 'sleep', 'request', 'mail', 'trigger', 'error', 'script']);
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
export function flowError(code, message, status = 400) {
  return status >= 500 ? Object.assign(new Error(message), { code, status }) : new ExtensionError(code, message, { status });
}

export function assertFlowJson(value, depth = 0) {
  if (depth > 32) throw flowError('INVALID_FLOW', 'Flow JSON is too deeply nested');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) assertFlowJson(item, depth + 1); return; }
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    for (const [key, item] of Object.entries(value)) {
      if (UNSAFE.has(key)) throw flowError('INVALID_FLOW', 'Unsafe JSON key');
      assertFlowJson(item, depth + 1);
    }
    return;
  }
  throw flowError('INVALID_FLOW', 'Flow values must be JSON');
}

export function flowPath(data, path) {
  const parts = String(path).trim().replace(/\[(\d+)\]/g, '.$1').split('.');
  if (!parts.length || parts.some(part => !part || UNSAFE.has(part) || !/^[A-Za-z0-9_$-]+$/.test(part))) {
    throw flowError('INVALID_FLOW_VARIABLE', 'Use a safe data-chain path');
  }
  let current = data;
  for (const part of parts) {
    if (current == null || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

export function resolveFlowTemplates(value, data) {
  if (Array.isArray(value)) return value.map(item => resolveFlowTemplates(item, data));
  if (value && typeof value === 'object') {
    assertFlowJson(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveFlowTemplates(item, data)]));
  }
  if (typeof value !== 'string') return value;
  const read = path => {
    const result = flowPath(data, path);
    if (result === undefined) throw flowError('FLOW_VARIABLE_NOT_FOUND', `Missing data-chain variable: ${path.trim()}`);
    return structuredClone(result);
  };
  const whole = value.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/);
  if (whole) return read(whole[1]);
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, path) => {
    const result = read(path);
    return result && typeof result === 'object' ? JSON.stringify(result) : String(result ?? '');
  });
}

function text(value, label, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw flowError('INVALID_FLOW', `Invalid ${label}`);
  return value.trim();
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw flowError('INVALID_FLOW', `${label} must be an object`);
  return structuredClone(value);
}
export function normalizeFlow(input, { operationTypes = FLOW_OPERATION_TYPES } = {}) {
  assertFlowJson(input);
  if (Buffer.byteLength(JSON.stringify(input)) > FLOW_LIMITS.bytes) throw flowError('INVALID_FLOW', 'Flow definition exceeds 256 KiB');
  const source = object(input, 'Flow');
  const flow = {
    name: text(source.name, 'flow name', 120, true), description: text(source.description, 'description', 2000),
    status: source.status ?? 'inactive', trigger: source.trigger ?? 'manual',
    accountability: source.accountability ?? 'trigger', run_as: source.run_as ?? null,
    options: object(source.options ?? {}, 'Trigger options'), entry: source.entry ?? null,
    operations: [],
  };
  if (!['active', 'inactive'].includes(flow.status) || !FLOW_TRIGGERS.includes(flow.trigger)) throw flowError('INVALID_FLOW', 'Invalid flow status or trigger');
  if (!['trigger', 'public', 'system', 'user'].includes(flow.accountability)) throw flowError('INVALID_FLOW', 'Choose an explicit execution accountability');
  if (flow.accountability === 'user' && (typeof flow.run_as !== 'string' || !/^[0-9a-f-]{36}$/i.test(flow.run_as))) throw flowError('INVALID_FLOW', 'User execution requires a Run as user UUID');
  if (flow.accountability !== 'user') flow.run_as = null;
  if (flow.trigger === 'schedule' && flow.accountability === 'trigger') throw flowError('INVALID_FLOW', 'Scheduled flows require explicit public, system or user execution');
  if (!Array.isArray(source.operations) || source.operations.length > FLOW_LIMITS.nodes) throw flowError('INVALID_FLOW', 'A flow supports at most 100 operations');
  const ids = new Set(), keys = new Set();
  for (const entry of source.operations) {
    const node = object(entry, 'Operation');
    const id = text(node.id, 'operation id', 64, true), key = text(node.key, 'operation key', 60, true);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || id === 'trigger' || ids.has(id) || !KEY.test(key) || keys.has(key) || UNSAFE.has(key)) throw flowError('INVALID_FLOW', 'Operation ids and keys must be safe and unique');
    if (!operationTypes.includes(node.type)) throw flowError('INVALID_FLOW', `Unsupported operation: ${node.type}`);
    const position = node.position ?? { x: 340, y: 100 };
    if (![position.x, position.y].every(n => Number.isFinite(n) && Math.abs(n) <= 100000)) throw flowError('INVALID_FLOW', 'Invalid node position');
    const options = object(node.options ?? {}, 'Operation options');
    if (typeof options.emit_events !== 'undefined' && typeof options.emit_events !== 'boolean') throw flowError('INVALID_FLOW', 'Emit flow events must be a boolean');
    flow.operations.push({ id, key, name: text(node.name ?? key, 'operation name', 120, true), type: node.type,
      position: { x: position.x, y: position.y }, options, resolve: node.resolve ?? null, reject: node.reject ?? null });
    ids.add(id); keys.add(key);
  }
  if (flow.entry !== null && !ids.has(flow.entry)) throw flowError('INVALID_FLOW', 'Trigger entry refers to a missing operation');
  if (flow.status === 'active' && (!flow.entry || !flow.operations.length)) throw flowError('INVALID_FLOW', 'Connect the trigger before activating a flow');
  const byId = new Map(flow.operations.map(node => [node.id, node]));
  for (const node of flow.operations) for (const branch of ['resolve', 'reject']) {
    if (node[branch] !== null && !ids.has(node[branch])) throw flowError('INVALID_FLOW', 'A connection refers to a missing operation');
  }
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    if (!id || visited.has(id)) return;
    if (visiting.has(id)) throw flowError('INVALID_FLOW', 'Circular connections are not allowed; use another-flow iteration');
    visiting.add(id); const node = byId.get(id); visit(node.resolve); visit(node.reject); visiting.delete(id); visited.add(id);
  };
  for (const node of flow.operations) visit(node.id);
  if (flow.options.allowed_roles !== undefined && (!Array.isArray(flow.options.allowed_roles) || flow.options.allowed_roles.length > 100 || flow.options.allowed_roles.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)))) throw flowError('INVALID_FLOW', 'Invalid manual trigger roles');
  const triggerKeys = {
    manual: ['response', 'collections', 'allowed_roles', 'require_selection', 'require_confirmation', 'confirmation'],
    event: ['response', 'mode', 'events', 'collections'], webhook: ['response', 'method', 'public'], schedule: ['response', 'cron'], operation: ['response'],
  };
  if (Object.keys(flow.options).some(key => !triggerKeys[flow.trigger].includes(key))) throw flowError('INVALID_FLOW', 'Unsupported trigger option');
  for (const key of ['require_selection', 'require_confirmation']) if (flow.options[key] !== undefined && typeof flow.options[key] !== 'boolean') throw flowError('INVALID_FLOW', `${key} must be a boolean`);
  if (flow.options.confirmation !== undefined && (typeof flow.options.confirmation !== 'string' || flow.options.confirmation.length > 1000)) throw flowError('INVALID_FLOW', 'Invalid confirmation description');
  if (flow.options.collections !== undefined && (!Array.isArray(flow.options.collections) || flow.options.collections.length > 100 || flow.options.collections.some(c => typeof c !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(c)))) throw flowError('INVALID_FLOW', 'Invalid trigger collections');
  if (flow.trigger === 'event') {
    if (!['filter', 'action'].includes(flow.options.mode) || !Array.isArray(flow.options.events) || !flow.options.events.length || flow.options.events.length > 20) throw flowError('INVALID_FLOW', 'Choose event scope and filter/action mode');
    if (!Array.isArray(flow.options.collections) || !flow.options.collections.length || flow.options.collections.some(c => typeof c !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(c))) throw flowError('INVALID_FLOW', 'Choose event collections');
  }
  if (flow.trigger === 'webhook') {
    flow.options.method ??= 'POST';
    if (!['GET', 'POST'].includes(flow.options.method) || (flow.options.public !== undefined && typeof flow.options.public !== 'boolean')) throw flowError('INVALID_FLOW', 'Invalid webhook method or access');
  }
  if (flow.trigger === 'schedule' && (typeof flow.options.cron !== 'string' || flow.options.cron.length > 100)) throw flowError('INVALID_FLOW', 'Provide a cron expression');
  if (flow.options.response !== undefined && flow.options.response !== null && typeof flow.options.response !== 'string') throw flowError('INVALID_FLOW', 'Response must name a data-chain path');
  if (flow.options.response && flow.options.response !== '$all') flowPath({}, flow.options.response);
  return flow;
}
