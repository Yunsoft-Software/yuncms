import { setTimeout as delay } from 'node:timers/promises';
import { redactAuditValue } from '../services/audit-service.js';
import { FLOW_LIMITS, FLOW_OPERATION_TYPES, assertFlowJson, flowError, flowPath, normalizeFlow, resolveFlowTemplates } from './definition.js';
import { flowExecutionStorage, withFlowEvents } from './context.js';
import { executeFlowScript } from './script.js';

export function safeFlowValue(value, maxBytes = 65536) {
  const json = JSON.stringify(redactAuditValue(value), (_key, entry) => {
    if (typeof entry === 'bigint') return String(entry);
    if (entry?.type === 'Buffer') return '[BINARY]';
    return entry;
  });
  if (json === undefined) return null;
  if (Buffer.byteLength(json) > maxBytes) return { truncated: true };
  return JSON.parse(json);
}

export function normalizeFlowValue(value) {
  const encoded = JSON.stringify(value ?? null, (_key, entry) => typeof entry === 'bigint' ? String(entry) : entry);
  if (Buffer.byteLength(encoded) > FLOW_LIMITS.bytes) throw flowError('FLOW_OUTPUT_LIMIT', 'Flow value exceeds 256 KiB');
  const parsed = JSON.parse(encoded);
  assertFlowJson(parsed);
  return parsed;
}

export function evaluateFlowCondition(input, rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules) || !Object.keys(rules).length) throw flowError('INVALID_FLOW_OPERATION', 'Provide condition rules');
  return Object.entries(rules).every(([path, rule]) => {
    if (path === '_and' || path === '_or') {
      if (!Array.isArray(rule) || !rule.length || rule.length > 100) throw flowError('INVALID_FLOW_OPERATION', 'Logical conditions require 1 to 100 rules');
      return path === '_and' ? rule.every(r => evaluateFlowCondition(input, r)) : rule.some(r => evaluateFlowCondition(input, r));
    }
    const actual = flowPath(input, path);
    if (actual === undefined) return false;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || !Object.keys(rule).length) throw flowError('INVALID_FLOW_OPERATION', 'Condition fields require operators');
    return Object.entries(rule).every(([operator, expected]) => {
      switch (operator) {
        case '_eq': return JSON.stringify(actual) === JSON.stringify(expected);
        case '_neq': return JSON.stringify(actual) !== JSON.stringify(expected);
        case '_null': return expected === true ? actual === null : actual !== null;
        case '_nnull': return expected === true ? actual !== null : actual === null;
        case '_gt': case '_gte': case '_lt': case '_lte': {
          if (!['string', 'number'].includes(typeof actual) || typeof actual !== typeof expected) return false;
          return operator === '_gt' ? actual > expected : operator === '_gte' ? actual >= expected : operator === '_lt' ? actual < expected : actual <= expected;
        }
        case '_in': case '_nin': {
          if (!Array.isArray(expected)) throw flowError('INVALID_FLOW_OPERATION', 'Membership condition requires an array');
          return operator === '_in' ? expected.includes(actual) : !expected.includes(actual);
        }
        case '_contains': return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
        case '_starts_with': return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
        case '_ends_with': return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
        default: throw flowError('INVALID_FLOW_OPERATION', `Unsupported condition operator: ${operator}`);
      }
    });
  });
}

async function requestOperation(options, context) {
  let url;
  try { url = new URL(options.url); } catch { throw flowError('INVALID_FLOW_OPERATION', 'Request URL is invalid'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || !context.requestHosts?.includes(url.hostname.toLowerCase())) {
    throw flowError('FLOW_REQUEST_FORBIDDEN', 'Request hostname must be explicitly allowed by the server', 403);
  }
  const method = String(options.method ?? 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) throw flowError('INVALID_FLOW_OPERATION', 'Unsupported request method');
  const headers = new Headers(options.headers ?? {});
  if (options.body !== undefined && !['GET', 'HEAD'].includes(method) && !headers.has('content-type')) headers.set('content-type', 'application/json');
  let response;
  try { response = await fetch(url, {
    method, headers, redirect: 'manual', signal: context.signal,
    ...(options.body !== undefined && !['GET', 'HEAD'].includes(method) ? { body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body) } : {}),
  }); } catch (error) {
    if (context.signal.aborted) throw error;
    throw flowError('FLOW_REQUEST_FAILED', 'External request could not complete', 502);
  }
  if (response.status >= 300 && response.status < 400) throw flowError('FLOW_REQUEST_REDIRECT', 'Flow requests do not follow redirects', 502);
  if (!response.ok) throw flowError('FLOW_REQUEST_FAILED', `External request returned ${response.status}`, 502);
  let length = 0, text = '';
  const decoder = new TextDecoder();
  if (response.body) for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > FLOW_LIMITS.bytes) { await response.body.cancel?.().catch(() => {}); throw flowError('FLOW_OUTPUT_LIMIT', 'External response exceeds 256 KiB'); }
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  let body = text;
  if (response.headers.get('content-type')?.includes('json') && text) {
    try { body = JSON.parse(text); } catch { throw flowError('FLOW_REQUEST_INVALID_JSON', 'External response is not valid JSON', 502); }
  }
  return { status: response.status, body };
}

function boundedIds(value) {
  const ids = Array.isArray(value) ? value : [value];
  if (!ids.length || ids.length > FLOW_LIMITS.iterations || ids.some(id => !['string', 'number'].includes(typeof id) || !String(id) || String(id).length > 191)) throw flowError('INVALID_FLOW_OPERATION', 'Provide 1 to 100 item ids');
  return ids;
}

async function operation(node, data, context) {
  const options = node.type === 'script' ? node.options : resolveFlowTemplates(node.options, data);
  switch (node.type) {
    case 'script': return executeFlowScript(options, data, context);
    case 'transform': return options.value ?? null;
    case 'condition': {
      if (!options.rules || typeof options.rules !== 'object' || Array.isArray(options.rules)) throw flowError('INVALID_FLOW_OPERATION', 'Condition rules are required');
      const input = options.value ?? data;
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw flowError('INVALID_FLOW_OPERATION', 'Conditions validate an object');
      if (!evaluateFlowCondition(input, options.rules)) throw flowError('FLOW_CONDITION_REJECTED', 'Condition did not match', 422);
      return null;
    }
    case 'error': {
      const status = options.status ?? 400;
      if (!Number.isInteger(status) || status < 400 || status > 499 || !/^[A-Z][A-Z0-9_]{0,79}$/.test(options.code ?? 'FLOW_REJECTED')) throw flowError('INVALID_FLOW_OPERATION', 'Choose a safe error code and a 4xx status');
      throw flowError(options.code ?? 'FLOW_REJECTED', String(options.message ?? 'Flow rejected the operation').slice(0, 1000), status);
    }
    case 'log': context.logger?.info?.('YunCMS flow message', { flow: context.flow.id, operation: node.key, message: safeFlowValue(options.message) }); return null;
    case 'sleep': {
      const ms = options.milliseconds;
      if (!Number.isInteger(ms) || ms < 0 || ms > 5000) throw flowError('INVALID_FLOW_OPERATION', 'Delay must be 0 to 5000 milliseconds');
      await delay(ms, undefined, { signal: context.signal }); return null;
    }
    case 'request': return requestOperation(options, context);
    case 'mail': {
      if (!context.mailer) throw flowError('MAIL_NOT_CONFIGURED', 'Configure SMTP before using Send email', 503);
      const recipients = Array.isArray(options.to) ? options.to : [options.to];
      if (!recipients.length || recipients.length > 20) throw flowError('INVALID_FLOW_OPERATION', 'Provide 1 to 20 recipients');
      for (const to of recipients) { context.signal.throwIfAborted(); await context.mailer.send({ to, subject: options.subject, text: options.text }, context); }
      return null;
    }
    case 'trigger': {
      if (!context.triggerFlow) throw flowError('INVALID_FLOW_OPERATION', 'Nested flow execution is unavailable');
      const inputs = Array.isArray(options.payload) ? options.payload : [options.payload ?? {}];
      if (inputs.length > FLOW_LIMITS.iterations) throw flowError('FLOW_ITERATION_LIMIT', 'Nested flow iteration supports at most 100 inputs');
      const output = [];
      for (const payload of inputs) { context.signal.throwIfAborted(); output.push(await context.triggerFlow(options.flow, payload, context)); }
      return Array.isArray(options.payload) ? output : output[0];
    }
    default: {
      if (context.operations?.has(node.type)) return context.operations.get(node.type)(options, { ...context, data: structuredClone(data) });
      if (!['read', 'create', 'update', 'delete'].includes(node.type)) throw flowError('INVALID_FLOW_OPERATION', 'Unsupported operation');
      if (typeof options.collection !== 'string' || !Object.hasOwn(context.schema.collections ?? {}, options.collection) || context.schema.collections[options.collection].system) throw flowError('INVALID_FLOW_OPERATION', 'Data operations require a project collection');
      const service = new context.services.ItemsService(options.collection, context);
      return withFlowEvents(options.emit_events === true, async () => {
        if (node.type === 'read') {
          if (options.ids !== undefined) {
            const rows = [];
            for (const id of boundedIds(options.ids)) { context.signal.throwIfAborted(); const row = await service.readOne(id, options.query ?? {}); if (row) rows.push(row); }
            return rows;
          }
          return service.readMany({ ...options.query, limit: Math.min(Number(options.query?.limit) || 100, 100) });
        }
        if (node.type === 'create') {
          const rows = Array.isArray(options.payload) ? options.payload : [options.payload];
          if (!rows.length || rows.length > 100) throw flowError('INVALID_FLOW_OPERATION', 'Create supports 1 to 100 items');
          return service.createMany(rows);
        }
        const ids = boundedIds(options.ids), results = [];
        for (const id of ids) {
          context.signal.throwIfAborted();
          results.push(node.type === 'update' ? await service.updateOne(id, options.payload) : await service.deleteOne(id));
        }
        return results;
      });
    }
  }
}

export async function executeFlowGraph(definition, context) {
  const customTypes = [...(context.operations?.keys() ?? [])];
  const flow = { ...normalizeFlow(definition, { operationTypes: [...new Set([...FLOW_OPERATION_TYPES, ...customTypes])] }), id: definition.id };
  const parent = flowExecutionStorage.getStore();
  const stack = parent?.stack ?? [];
  if (stack.includes(flow.id) || stack.length >= FLOW_LIMITS.depth) throw flowError('FLOW_RECURSION_LIMIT', 'Flow recursion limit reached');
  const signal = context.signal ?? AbortSignal.timeout(FLOW_LIMITS.durationMs);
  const checkDeadline = () => { if (signal.aborted) throw flowError('FLOW_TIMEOUT', 'Flow execution deadline exceeded', 504); };
  const budget = context.budget ?? { remaining: 500 };
  const chain = { $trigger: structuredClone(context.trigger ?? {}), $accountability: {
    user: context.accountability.user ?? null, role: context.accountability.role ?? null,
    admin: context.accountability.admin === true, public: context.accountability.public === true, system: context.accountability.system === true,
  }, $env: structuredClone(context.env ?? {}), $last: null };
  assertFlowJson(chain);
  const nodes = new Map(flow.operations.map(node => [node.id, node]));
  const trace = [];
  return flowExecutionStorage.run({ stack: [...stack, flow.id], suppressFlowEvents: parent?.suppressFlowEvents ?? false }, async () => {
    let id = flow.entry, count = 0;
    while (id) {
      checkDeadline();
      if (++count > FLOW_LIMITS.steps) throw flowError('FLOW_STEP_LIMIT', 'Flow step limit reached');
      if (--budget.remaining < 0) throw flowError('FLOW_STEP_LIMIT', 'Nested execution exceeded 500 total steps');
      const node = nodes.get(id), startedAt = Date.now();
      try {
        const result = normalizeFlowValue(await operation(node, chain, { ...context, flow, signal, budget }));
        checkDeadline();
        chain[node.key] = result ?? null; chain.$last = result ?? null;
        trace.push({ id: node.id, key: node.key, status: 'succeeded', output: safeFlowValue(result), duration_ms: Date.now() - startedAt });
        id = node.resolve;
      } catch (error) {
        if (signal.aborted) error = flowError('FLOW_TIMEOUT', 'Flow execution deadline exceeded', 504);
        const safe = { code: error.code ?? 'FLOW_OPERATION_FAILED', message: error.status < 500 ? error.message : 'Operation failed' };
        chain[node.key] = safe; chain.$last = safe;
        trace.push({ id: node.id, key: node.key, status: 'failed', output: safe, duration_ms: Date.now() - startedAt });
        if (!node.reject || signal.aborted) { error.flowTrace = trace; throw error; }
        id = node.reject;
      }
      if (Buffer.byteLength(JSON.stringify(chain)) > FLOW_LIMITS.bytes) throw flowError('FLOW_OUTPUT_LIMIT', 'Data chain exceeds 256 KiB');
    }
    const output = flow.options.response === '$all' ? chain : flow.options.response ? flowPath(chain, flow.options.response) : chain.$last;
    return { output: output ?? null, trace, chain };
  });
}
