import { parseCronExpression, cronMatches } from '@yunsoft/yuncms-core';
import { createHash } from 'node:crypto';
import {
  activeAdvisoryLockConnection,
  createSystemAccountability,
  loadConfig,
  withAdvisoryLock,
} from '@yunsoft/yuncms-core';
import { resolveServiceOptionsInput } from '../service-options.js';

const JOB_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
function scheduleError(message) { return Object.assign(new Error(message), { code: 'INVALID_EXTENSION_SCHEDULE' }); }
export { parseCronExpression, cronMatches } from '@yunsoft/yuncms-core';

export function resolveExtensionAuthConfig(authConfig, env) {
  if (authConfig !== undefined) return authConfig;
  if (env?.auth && typeof env.auth === 'object') return env.auth;
  if (env && typeof env === 'object') {
    try {
      return loadConfig(env).auth;
    } catch {
      return env.AUTH_TOTP_KEY ? { totpKey: String(env.AUTH_TOTP_KEY) } : null;
    }
  }
  return null;
}

export function resolveSchedulerConcurrency(database, env, configured) {
  if (Number.isInteger(configured) && configured >= 1) return configured;
  const rawLimit = Number(
    database?.pool?.config?.connectionLimit
      ?? env?.DB_CONNECTION_LIMIT
      ?? env?.database?.connectionLimit,
  );
  if (Number.isInteger(rawLimit) && rawLimit >= 1) {
    return Math.max(1, Math.floor((rawLimit - 1) / 2));
  }
  return 1;
}

function normalizeJobOptions(options = {}) {
  const id = String(options.id ?? '').trim();
  if (!JOB_ID_PATTERN.test(id)) {
    throw scheduleError('Scheduled extension job requires a stable id using letters, numbers, dot, underscore, colon or dash');
  }
  const mode = options.mode ?? 'per_process';
  if (!['per_process', 'singleton'].includes(mode)) {
    throw scheduleError('Scheduled extension job mode must be per_process or singleton');
  }
  if ((options.overlap ?? 'skip') !== 'skip') {
    throw scheduleError('Scheduled extension job overlap currently supports skip only');
  }
  if (options.accountability !== 'system') {
    throw scheduleError("Scheduled extension jobs must explicitly set accountability: 'system'");
  }
  return Object.freeze({ id, mode, overlap: 'skip', accountability: 'system' });
}

function minuteKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
}

export function scheduleLockName(identity) {
  const digest = createHash('sha256').update(String(identity)).digest('hex').slice(0, 40);
  return `yuncms:schedule:${digest}`;
}

export class ExtensionScheduler {
  constructor({
    database,
    services,
    schemaCache,
    emitter,
    storage = null,
    logger = console,
    env,
    authConfig,
    maxConcurrentSingletons,
    now = () => new Date(),
    lockRunner = withAdvisoryLock,
  } = {}) {
    if (!database || !services || !schemaCache || !emitter) {
      throw new Error('Extension scheduler requires database, services, schemaCache and emitter');
    }
    this.database = database;
    this.services = services;
    this.schemaCache = schemaCache;
    this.emitter = emitter;
    this.storage = storage;
    this.logger = logger;
    this.env = env;
    this.authConfig = resolveExtensionAuthConfig(authConfig, env);
    this.maxConcurrentSingletons = resolveSchedulerConcurrency(database, env, maxConcurrentSingletons);
    this.activeSingletons = 0;
    this.singletonQueue = [];
    this.now = now;
    this.lockRunner = lockRunner;
    this.jobs = new Map();
    this.timer = null;
    this.stopping = false;
    this.runningPromises = new Set();
  }

  async #acquireSingletonSlot() {
    while (!this.stopping && this.activeSingletons >= this.maxConcurrentSingletons) {
      await new Promise((resolve) => this.singletonQueue.push(resolve));
    }
    if (this.stopping) return false;
    this.activeSingletons += 1;
    return true;
  }

  #releaseSingletonSlot() {
    this.activeSingletons = Math.max(0, this.activeSingletons - 1);
    const next = this.singletonQueue.shift();
    if (next) next();
  }

  register(extensionId, expression, handler, options = {}) {
    if (typeof handler !== 'function') throw scheduleError('Scheduled extension handler must be a function');
    const parsed = parseCronExpression(expression);
    const normalized = normalizeJobOptions(options);
    const identity = `${extensionId}:${normalized.id}`;
    if (this.jobs.has(identity)) throw scheduleError(`Duplicate scheduled extension job: ${identity}`);
    const job = {
      identity,
      extensionId,
      expression,
      parsed,
      handler,
      options: normalized,
      running: false,
      lastMinute: null,
    };
    this.jobs.set(identity, job);
    return () => this.jobs.delete(identity);
  }

  async #context(job, date, scope = { active: true, connection: this.database }) {
    const resolveActiveDb = () => (scope.active ? (scope.connection ?? this.database) : this.database);
    const initialDatabase = resolveActiveDb();
    const accountability = createSystemAccountability();
    const requestId = `schedule:${job.identity}:${date.toISOString()}`;
    const schema = await this.schemaCache.get(initialDatabase);
    const context = {
      services: this.services,
      pool: this.database,
      logger: this.logger,
      env: this.env,
      emitter: this.emitter,
      storage: this.storage,
      accountability,
      requestId,
      authConfig: this.authConfig,
      getSchema: (db) => {
        const currentDb = resolveActiveDb();
        return this.schemaCache.get(db ?? activeAdvisoryLockConnection(currentDb));
      },
      serviceOptions: async (first = null, second = null) => {
        const currentDb = resolveActiveDb();
        const { req, overrides: extra } = resolveServiceOptionsInput(first, second);
        const resolvedDatabase = extra.database
          ?? activeAdvisoryLockConnection(req?.context?.database ?? currentDb);
        const resolvedSchema = extra.schema
          ?? req?.context?.schema
          ?? (resolvedDatabase === initialDatabase ? schema : await this.schemaCache.get(resolvedDatabase));
        return {
          accountability: req?.accountability ?? accountability,
          database: resolvedDatabase,
          schema: resolvedSchema,
          logger: this.logger,
          emitter: this.emitter,
          storage: this.storage,
          permissionCache: req?.context?.permissionCache ?? null,
          requestId: req?.id ?? requestId,
          authConfig: req?.context?.env?.auth ?? this.authConfig,
          ...extra,
          database: resolvedDatabase,
          schema: resolvedSchema,
        };
      },
      schedule: Object.freeze({
        id: job.options.id,
        extensionId: job.extensionId,
        expression: job.expression,
        mode: job.options.mode,
        scheduledAt: date,
      }),
    };
    Object.defineProperty(context, 'database', {
      enumerable: true,
      get: resolveActiveDb,
    });
    return Object.freeze(context);
  }

  async #execute(job, date) {
    if (job.running) {
      this.logger?.warn?.('Skipping overlapping YunCMS extension job', { job: job.identity });
      return false;
    }
    job.running = true;
    const startedAt = Date.now();
    this.logger?.info?.('Starting YunCMS extension job', { job: job.identity, mode: job.options.mode });
    try {
      const scope = { active: true, connection: this.database };
      const run = async (jobDatabase = this.database) => {
        scope.connection = jobDatabase ?? this.database;
        try {
          return await job.handler(await this.#context(job, date, scope));
        } finally {
          scope.active = false;
          scope.connection = this.database;
        }
      };
      if (job.options.mode === 'singleton') {
        const acquiredSlot = await this.#acquireSingletonSlot();
        if (!acquiredSlot) return false;
        try {
          await this.lockRunner(
            this.database,
            scheduleLockName(job.identity),
            (lockConnection) => run(lockConnection ?? this.database),
            { timeoutSeconds: 0 },
          );
        } catch (error) {
          if (error?.code === 'SCHEMA_LOCK_UNAVAILABLE') {
            this.logger?.info?.('Skipping YunCMS singleton extension job owned by another replica', { job: job.identity });
            return false;
          }
          throw error;
        } finally {
          this.#releaseSingletonSlot();
        }
      } else {
        await run(this.database);
      }
      this.logger?.info?.('Completed YunCMS extension job', {
        job: job.identity,
        durationMs: Date.now() - startedAt,
      });
      return true;
    } catch (error) {
      this.logger?.error?.('YunCMS extension job failed', {
        job: job.identity,
        durationMs: Date.now() - startedAt,
        code: error?.code ?? null,
        message: error?.message ?? String(error),
      });
      return false;
    } finally {
      job.running = false;
    }
  }

  async runDue(date = this.now()) {
    if (this.stopping) return [];
    const executions = [];
    const key = minuteKey(date);
    for (const job of this.jobs.values()) {
      if (job.lastMinute === key || !cronMatches(job.parsed, date)) continue;
      job.lastMinute = key;
      const execution = this.#execute(job, date);
      this.runningPromises.add(execution);
      execution.finally(() => this.runningPromises.delete(execution));
      executions.push(execution);
    }
    return Promise.all(executions);
  }

  start() {
    if (this.timer || this.stopping) return;
    const tick = () => this.runDue().catch((error) => {
      this.logger?.error?.('YunCMS extension scheduler tick failed', { code: error?.code ?? null });
    });
    tick();
    this.timer = setInterval(tick, 15_000);
    this.timer.unref?.();
  }

  async stop({ timeoutMs = 5_000 } = {}) {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.singletonQueue.length > 0) {
      const wake = this.singletonQueue.shift();
      wake?.();
    }
    const running = [...this.runningPromises];
    if (running.length === 0) return true;
    let timeout;
    const completed = await Promise.race([
      Promise.allSettled(running).then(() => true),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
        timeout.unref?.();
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    return completed;
  }
}

export { normalizeJobOptions };
