import { randomUUID } from 'node:crypto';
import { createAccountability, createPublicAccountability, createSystemAccountability } from '../accountability.js';
import { SchemaCache } from '../schema.js';
import { withTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';
import { FLOW_LIMITS, FLOW_OPERATION_TYPES, assertFlowJson, flowError, normalizeFlow } from '../flows/definition.js';
import { executeFlowGraph, safeFlowValue } from '../flows/engine.js';
import { parseFlowCronExpression } from '../flows/cron.js';
import { flowExecutionStorage } from '../flows/context.js';

export const FLOW_FILTER_EVENTS = Object.freeze(['items.create', 'items.update', 'items.delete', 'users.update', 'users.delete', 'users.password.update']);
export const FLOW_ACTION_EVENTS = Object.freeze([...FLOW_FILTER_EVENTS, 'users.create', 'files.create', 'files.update', 'files.delete']);
function decode(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function fromRow(row) {
  return row ? { ...decode(row.definition), id: row.id, revision: row.revision, user_created: row.user_created,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at } : null;
}
function json(value) {
  const parsed = JSON.parse(JSON.stringify(value ?? null, (_key, entry) => typeof entry === 'bigint' ? String(entry) : entry));
  assertFlowJson(parsed);
  if (Buffer.byteLength(JSON.stringify(parsed)) > FLOW_LIMITS.bytes) throw flowError('INVALID_FLOW', 'Flow input exceeds 256 KiB');
  return parsed;
}

export class FlowsService extends BaseService {
  constructor(options = {}) {
    super(options);
    this.schemaCache = options.schemaCache ?? new SchemaCache();
    this.services = options.services ?? null;
    this.mailer = options.mailer ?? null;
    this.operations = options.operations ?? new Map();
    this.requestHosts = options.requestHosts ?? [];
    this.flowEnv = options.flowEnv ?? {};
    this.fetch = options.fetch;
  }

  requireManager() {
    if (this.accountability.admin !== true && this.accountability.system !== true) throw flowError('FORBIDDEN', 'Flow management requires administrator accountability', 403);
  }
  requireSystem() {
    if (this.accountability.system !== true) throw flowError('FORBIDDEN', 'Internal flow dispatch requires explicit system accountability', 403);
  }
  async #load(id, database = this.database, { lock = false } = {}) {
    if (typeof id !== 'string' || id.length > 64) throw flowError('FLOW_NOT_FOUND', 'Flow not found', 404);
    const [rows] = await database.query(`SELECT * FROM yuncms_flows WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
    if (!rows[0]) throw flowError('FLOW_NOT_FOUND', 'Flow not found', 404);
    return fromRow(rows[0]);
  }
  async readOne(id) { this.requireManager(); return this.#load(id); }
  async readMany() {
    this.requireManager();
    const [rows] = await this.database.query('SELECT * FROM yuncms_flows ORDER BY created_at DESC, id DESC LIMIT 500');
    return rows.map(fromRow);
  }
  async configuration() {
    this.requireManager();
    const schema = this.schema ?? await this.schemaCache.get(this.database);
    const [roles] = await this.database.query('SELECT id, name, admin, public FROM yuncms_roles ORDER BY name LIMIT 500');
    const [users] = await this.database.query("SELECT u.id, u.email FROM yuncms_users u INNER JOIN yuncms_roles r ON r.id = u.role WHERE u.status = 'active' AND r.admin = 0 AND r.public = 0 ORDER BY u.email LIMIT 500");
    return { roles, users, collections: Object.values(schema.collections).filter(c => !c.system).map(c => ({ collection: c.collection, name: c.name ?? c.collection })),
      operations: [...new Set([...FLOW_OPERATION_TYPES, ...this.operations.keys()])], filter_events: FLOW_FILTER_EVENTS, action_events: FLOW_ACTION_EVENTS, limits: FLOW_LIMITS };
  }
  async save(input, id = null) {
    this.requireManager();
    const flow = normalizeFlow(input, { operationTypes: [...FLOW_OPERATION_TYPES, ...this.operations.keys()] });
    if (flow.trigger === 'schedule') {
      try { parseFlowCronExpression(flow.options.cron); } catch { throw flowError('INVALID_FLOW', 'Provide a valid 5 or 6 field cron expression'); }
    }
    if (flow.trigger === 'event' && flow.options.events.some(event => !(flow.options.mode === 'filter' ? FLOW_FILTER_EVENTS : FLOW_ACTION_EVENTS).includes(event))) throw flowError('INVALID_FLOW', 'Unsupported native flow event');
    if (flow.run_as) await this.#userAccountability(flow.run_as, this.database, { normalOnly: true });
    const definition = JSON.stringify(flow);
    if (id) {
      if (!Number.isInteger(input.revision) || input.revision < 1) throw flowError('INVALID_FLOW', 'Provide the current revision when updating a flow');
      const [result] = await this.database.query('UPDATE yuncms_flows SET name = ?, status = ?, trigger_type = ?, definition = ?, revision = revision + 1 WHERE id = ? AND revision = ?',
        [flow.name, flow.status, flow.trigger, definition, id, input.revision]);
      if (!result.affectedRows) { await this.#load(id); throw flowError('FLOW_REVISION_CONFLICT', 'Flow changed elsewhere; reload before saving', 409); }
    } else {
      id = randomUUID();
      await this.database.query('INSERT INTO yuncms_flows (id, name, status, trigger_type, definition, user_created) VALUES (?, ?, ?, ?, ?, ?)',
        [id, flow.name, flow.status, flow.trigger, definition, this.accountability.user]);
    }
    return this.#load(id);
  }
  async deleteOne(id, revision) {
    this.requireManager();
    if (!Number.isInteger(revision) || revision < 1) throw flowError('INVALID_FLOW', 'Provide the current revision when deleting a flow');
    const [result] = await this.database.query('DELETE FROM yuncms_flows WHERE id = ? AND revision = ?', [id, revision]);
    if (!result.affectedRows) { await this.#load(id); throw flowError('FLOW_REVISION_CONFLICT', 'Flow changed elsewhere; reload before deleting', 409); }
    return true;
  }
  async readRuns(id) {
    this.requireManager(); await this.#load(id);
    const [rows] = await this.database.query('SELECT id, flow_id, revision, status, CAST(trigger_data AS CHAR) AS trigger_data, CAST(actor AS CHAR) AS actor, request_id, CAST(trace AS CHAR) AS trace, CAST(output AS CHAR) AS output, error_code, created_at, started_at, finished_at FROM yuncms_flow_runs WHERE flow_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [id]);
    return rows.map(row => ({ ...row, ...Object.fromEntries(['trigger_data', 'actor', 'trace', 'output'].map(key => [key, safeFlowValue(decode(row[key]))])) }));
  }
  async #userAccountability(id, database, { normalOnly = false } = {}) {
    const [rows] = await database.query('SELECT u.id, u.role, u.status, r.admin, r.public FROM yuncms_users u INNER JOIN yuncms_roles r ON r.id = u.role WHERE u.id = ?', [id]);
    const user = rows[0];
    if (!user || user.status !== 'active' || user.public || (normalOnly && user.admin)) throw flowError('FLOW_ACTOR_UNAVAILABLE', 'Flow actor must be active with an allowed role', 403);
    return createAccountability({ user: user.id, role: user.role, admin: Boolean(user.admin) });
  }
  async #actor(flow, actor, database) {
    if (flow.accountability === 'system') return createSystemAccountability();
    if (flow.accountability === 'user') return this.#userAccountability(flow.run_as, database, { normalOnly: true });
    if (flow.accountability === 'public' || actor.public) {
      const [roles] = await database.query('SELECT id FROM yuncms_roles WHERE public = 1 LIMIT 1');
      return createPublicAccountability({ role: roles[0]?.id ?? null });
    }
    if (actor.system === true) return createSystemAccountability();
    if (!actor.user) throw flowError('FORBIDDEN', 'A trigger actor is required', 403);
    return this.#userAccountability(actor.user, database);
  }
  async availableManual(collection = null) {
    if (!this.accountability.user && !this.accountability.system) throw flowError('FORBIDDEN', 'Manual flows require authentication', 403);
    const [rows] = await this.database.query("SELECT * FROM yuncms_flows WHERE trigger_type = 'manual' AND status = 'active' ORDER BY name LIMIT 500");
    return rows.map(fromRow).filter(flow => this.#manualAllowed(flow) && (!collection || flow.options.collections?.includes(collection)))
      .map(flow => ({ id: flow.id, name: flow.name, require_confirmation: flow.options.require_confirmation === true, confirmation: flow.options.confirmation ?? '', require_selection: flow.options.require_selection === true }));
  }
  #manualAllowed(flow) {
    return this.accountability.admin === true || this.accountability.system === true || (Boolean(this.accountability.user) && flow.options.allowed_roles?.includes(this.accountability.role));
  }
  async runManual(id, input = {}) {
    const flow = await this.#load(id);
    if (flow.trigger !== 'manual' || !this.#manualAllowed(flow)) throw flowError('FORBIDDEN', 'This manual flow is unavailable to the caller', 403);
    if (flow.options.require_selection && (!Array.isArray(input.keys) || !input.keys.length)) throw flowError('INVALID_FLOW', 'Select one or more records before running this flow');
    if (flow.options.collections?.length && !flow.options.collections.includes(input.collection)) throw flowError('FORBIDDEN', 'This flow is unavailable for the selected collection', 403);
    return this.#execute(flow, json(input), this.accountability);
  }
  async runWebhook(id, input, method) {
    const flow = await this.#load(id);
    if (flow.trigger !== 'webhook' || flow.options.method !== method) throw flowError('FLOW_NOT_FOUND', 'Webhook not found', 404);
    if (!flow.options.public && !this.accountability.admin && !this.accountability.system) throw flowError('FORBIDDEN', 'This webhook requires an administrator', 403);
    return this.#execute(flow, json(input), this.accountability);
  }
  async runTriggered(id, input, actor, { database = this.database, runId = null, signal = null, budget = null, revision = null } = {}) {
    this.requireSystem();
    const flow = await this.#load(id, database);
    if (revision !== null && flow.revision !== revision) throw flowError('FLOW_REVISION_CONFLICT', 'Flow definition changed before execution', 409);
    return this.#execute(flow, json(input), actor, { database, runId, signal, budget });
  }
  async #execute(flow, trigger, actor, { database = this.database, runId = null, signal = null, budget = null } = {}) {
    if (flow.status !== 'active') throw flowError('FLOW_INACTIVE', 'Activate the flow before executing it', 409);
    const id = runId ?? randomUUID();
    if (!runId) await database.query("INSERT INTO yuncms_flow_runs (id, flow_id, revision, status, trigger_data, actor, request_id, started_at, lease_until) VALUES (?, ?, ?, 'running', ?, ?, ?, CURRENT_TIMESTAMP(3), DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 MINUTE))",
      [id, flow.id, flow.revision, JSON.stringify(safeFlowValue(trigger)), JSON.stringify(safeFlowValue(actor)), this.requestId]);
    try {
      const accountability = await this.#actor(flow, actor, database);
      const services = this.services ?? (await import('./core-services.js')).createCoreServiceRegistry().toObject();
      const schema = await this.schemaCache.get(database);
      const result = await executeFlowGraph(flow, { database, schema, accountability, services, trigger,
        emitter: this.emitter, storage: this.storage, logger: this.logger, mailer: this.mailer, permissionCache: this.permissionCache,
        requestId: this.requestId, requestHosts: this.requestHosts, env: this.flowEnv, operations: this.operations,
        fetch: this.fetch, ...(signal ? { signal } : {}), ...(budget ? { budget } : {}),
        triggerFlow: async (childId, payload, context) => {
          const child = await this.#load(childId, database);
          if (child.trigger !== 'operation') throw flowError('INVALID_FLOW_OPERATION', 'Choose a flow with Another flow trigger');
          return (await this.#execute(child, json(payload), accountability, { database, signal: context.signal, budget: context.budget })).output;
        },
      });
      await database.query("UPDATE yuncms_flow_runs SET status = 'succeeded', trace = ?, output = ?, finished_at = CURRENT_TIMESTAMP(3), lease_until = NULL WHERE id = ?",
        [JSON.stringify(result.trace), JSON.stringify(safeFlowValue(result.output)), id]);
      return { id, status: 'succeeded', output: result.output, trace: result.trace };
    } catch (error) {
      await database.query("UPDATE yuncms_flow_runs SET status = 'failed', trace = ?, error_code = ?, finished_at = CURRENT_TIMESTAMP(3), lease_until = NULL WHERE id = ?",
        [JSON.stringify(error.flowTrace ?? []), String(error.code ?? 'FLOW_OPERATION_FAILED').slice(0, 100), id]);
      throw error;
    }
  }
  async dispatchable(trigger, database = this.database) {
    this.requireSystem();
    const [rows] = await database.query("SELECT * FROM yuncms_flows WHERE trigger_type = ? AND status = 'active' ORDER BY created_at, id LIMIT 500", [trigger]);
    return rows.map(fromRow);
  }
  async enqueue(flow, trigger, actor, { database = this.database, scheduleKey = null } = {}) {
    this.requireSystem();
    return withTransaction(database, async connection => {
      const current = await this.#load(flow.id, connection, { lock: true });
      if (current.status !== 'active' || current.revision !== flow.revision) return null;
      const [[count]] = await connection.query("SELECT COUNT(*) AS total FROM yuncms_flow_runs WHERE flow_id = ? AND status IN ('pending', 'running')", [flow.id]);
      if (Number(count.total) >= 1000) throw flowError('FLOW_QUEUE_FULL', 'Flow queue is full', 429);
      const id = randomUUID();
      try {
        await connection.query('INSERT INTO yuncms_flow_runs (id, flow_id, revision, trigger_data, actor, request_id, schedule_key, lineage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, flow.id, flow.revision, JSON.stringify(json(trigger)), JSON.stringify(safeFlowValue(actor)), this.requestId, scheduleKey, JSON.stringify(flowExecutionStorage.getStore()?.stack ?? [])]);
      } catch (error) { if (scheduleKey && error.code === 'ER_DUP_ENTRY') return null; throw error; }
      return id;
    });
  }
  async runNext() {
    this.requireSystem();
    await this.database.query("UPDATE yuncms_flow_runs SET status = 'failed', error_code = 'FLOW_RUN_INTERRUPTED', finished_at = CURRENT_TIMESTAMP(3), lease_until = NULL WHERE status = 'running' AND lease_until < CURRENT_TIMESTAMP(3)");
    const job = await withTransaction(this.database, async connection => {
      const [rows] = await connection.query("SELECT *, CAST(trigger_data AS CHAR) AS trigger_data, CAST(actor AS CHAR) AS actor, CAST(lineage AS CHAR) AS lineage FROM yuncms_flow_runs WHERE status = 'pending' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED");
      if (!rows[0]) return null;
      await connection.query("UPDATE yuncms_flow_runs SET status = 'running', trigger_data = ?, started_at = CURRENT_TIMESTAMP(3), lease_until = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE id = ?", [JSON.stringify(safeFlowValue(decode(rows[0].trigger_data))), rows[0].id]);
      return rows[0];
    });
    if (!job) return false;
    const flow = await this.#load(job.flow_id);
    if (flow.status !== 'active' || flow.revision !== job.revision) {
      await this.database.query("UPDATE yuncms_flow_runs SET status = 'skipped', error_code = 'FLOW_DEFINITION_CHANGED', finished_at = CURRENT_TIMESTAMP(3), lease_until = NULL WHERE id = ?", [job.id]);
      return true;
    }
    try {
      const stack = decode(job.lineage) ?? [];
      if (!Array.isArray(stack) || stack.length > FLOW_LIMITS.depth || stack.some(id => typeof id !== 'string')) throw flowError('FLOW_RECURSION_LIMIT', 'Invalid flow ancestry');
      await flowExecutionStorage.run({ stack, suppressFlowEvents: false }, () => this.runTriggered(flow.id, decode(job.trigger_data), decode(job.actor), { runId: job.id, revision: job.revision }));
    }
    catch (error) {
      await this.database.query('UPDATE yuncms_flow_runs SET status = ?, error_code = ?, finished_at = CURRENT_TIMESTAMP(3), lease_until = NULL WHERE id = ?',
        [error.code === 'FLOW_REVISION_CONFLICT' ? 'skipped' : 'failed', String(error.code ?? 'FLOW_OPERATION_FAILED').slice(0, 100), job.id]);
      this.logger?.error?.('YunCMS background flow failed', { flow: flow.id, run: job.id, code: error.code ?? 'FLOW_OPERATION_FAILED' });
    }
    return true;
  }
}
