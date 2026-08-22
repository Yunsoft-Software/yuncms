import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

function hookError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export const HOOK_EVENTS = Object.freeze({
  itemQuery: 'items.query',
  itemRead: 'items.read',
  itemCreate: 'items.create',
  itemUpdate: 'items.update',
  itemDelete: 'items.delete',
  fileCreate: 'files.create',
  fileUpdate: 'files.update',
  fileDelete: 'files.delete',
  fileRead: 'files.read',
  userCreate: 'users.create',
  userUpdate: 'users.update',
  userDelete: 'users.delete',
  userPasswordUpdate: 'users.password.update',
  roleCreate: 'roles.create',
  roleUpdate: 'roles.update',
  roleDelete: 'roles.delete',
  permissionCreate: 'permissions.create',
  permissionUpdate: 'permissions.update',
  permissionDelete: 'permissions.delete',
  schemaCollectionCreate: 'schema.collection.create',
  schemaCollectionUpdate: 'schema.collection.update',
  schemaCollectionDelete: 'schema.collection.delete',
  schemaFieldCreate: 'schema.field.create',
  schemaFieldUpdate: 'schema.field.update',
  schemaFieldDelete: 'schema.field.delete',
  schemaRelationCreate: 'schema.relation.create',
  schemaRelationDelete: 'schema.relation.delete',
  schemaChanged: 'schema.changed',
  authLoginSuccess: 'auth.login.success',
  authLoginFailed: 'auth.login.failed',
  authRefreshSuccess: 'auth.refresh.success',
  authLogout: 'auth.logout',
  mailSend: 'mail.send',
  mailSent: 'mail.sent',
  mailFailed: 'mail.failed',
  requestReceived: 'request.received',
  requestCompleted: 'request.completed',
  requestFailed: 'request.failed',
  appBeforeStart: 'app.beforeStart',
  appAfterStart: 'app.afterStart',
  appBeforeStop: 'app.beforeStop',
  appAfterStop: 'app.afterStop',
});

function normalizeRegistrationOptions(options = {}) {
  const priority = options?.priority ?? 0;
  if (!Number.isInteger(priority) || priority < -10_000 || priority > 10_000) {
    throw new Error('Hook priority must be an integer between -10000 and 10000');
  }
  return {
    priority,
    extensionId: typeof options?.extensionId === 'string' && options.extensionId.trim()
      ? options.extensionId.trim()
      : 'core',
  };
}

export class HookEmitter {
  constructor({ maxDepth = 12, logger = console } = {}) {
    if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 100) {
      throw new Error('Hook maxDepth must be an integer between 1 and 100');
    }

    this.maxDepth = maxDepth;
    this.logger = logger;
    this.filters = new Map();
    this.actions = new Map();
    this.initializers = new Map();
    this.storage = new AsyncLocalStorage();
    this.registrationIndex = 0;
  }

  registerFilter(event, handler, options = {}) {
    return this.#register(this.filters, event, handler, options);
  }

  registerAction(event, handler, options = {}) {
    return this.#register(this.actions, event, handler, options);
  }

  registerInit(event, handler, options = {}) {
    return this.#register(this.initializers, event, handler, options);
  }

  #register(map, event, handler, options) {
    if (typeof event !== 'string' || event.trim() === '') throw new Error('Hook event is required');
    if (typeof handler !== 'function') throw new Error(`Hook handler for ${event} must be a function`);

    const name = event.trim();
    const registration = {
      handler,
      ...normalizeRegistrationOptions(options),
      index: this.registrationIndex++,
    };
    const handlers = map.get(name) ?? [];
    handlers.push(registration);
    handlers.sort((left, right) => (
      right.priority - left.priority
      || left.extensionId.localeCompare(right.extensionId)
      || left.index - right.index
    ));
    map.set(name, handlers);

    return () => {
      const active = map.get(name) ?? [];
      const next = active.filter((candidate) => candidate !== registration);
      if (next.length === 0) map.delete(name);
      else map.set(name, next);
    };
  }

  #nextExecution(event, registration = null) {
    const current = this.storage.getStore();
    const depth = (current?.depth ?? 0) + 1;
    if (depth > this.maxDepth) {
      throw hookError(
        'HOOK_RECURSION_LIMIT',
        `Hook recursion limit exceeded while dispatching ${event}`,
      );
    }

    return {
      chainId: current?.chainId ?? randomUUID(),
      depth,
      stack: [...(current?.stack ?? []), event],
      events: [...(current?.events ?? []), event],
      originExtension: current?.originExtension ?? registration?.extensionId ?? null,
      originEvent: current?.originEvent ?? event,
    };
  }

  async #runWithExecution(event, registration, operation) {
    const execution = this.#nextExecution(event, registration);
    return this.storage.run(execution, () => operation(execution));
  }

  async filter(event, payload, context = {}) {
    const handlers = this.filters.get(event) ?? [];
    if (handlers.length === 0) return payload;

    let current = payload;
    for (const registration of handlers) {
      current = await this.#runWithExecution(event, registration, async (execution) => {
        const next = await registration.handler(current, {
          ...context,
          hook: execution,
          event,
          extensionId: registration.extensionId,
        });
        return next === undefined ? current : next;
      });
    }
    return current;
  }

  async action(event, payload, context = {}) {
    const handlers = this.actions.get(event) ?? [];
    if (handlers.length === 0) return;

    for (const registration of handlers) {
      try {
        await this.#runWithExecution(event, registration, async (execution) => {
          await registration.handler(payload, {
            ...context,
            hook: execution,
            event,
            extensionId: registration.extensionId,
          });
        });
      } catch (error) {
        this.logger?.error?.('YunCMS extension action failed after successful lifecycle point', {
          event,
          extensionId: registration.extensionId,
          code: error?.code ?? null,
          message: error?.message ?? String(error),
        });
      }
    }
  }

  async init(event, context = {}) {
    const handlers = this.initializers.get(event) ?? [];
    if (handlers.length === 0) return;

    for (const registration of handlers) {
      await this.#runWithExecution(`init:${event}`, registration, async (execution) => {
        await registration.handler({
          ...context,
          hook: execution,
          event,
          extensionId: registration.extensionId,
        });
      });
    }
  }
}
