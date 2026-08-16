import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

function hookError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export class HookEmitter {
  constructor({ maxDepth = 12 } = {}) {
    if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 100) {
      throw new Error('Hook maxDepth must be an integer between 1 and 100');
    }

    this.maxDepth = maxDepth;
    this.filters = new Map();
    this.actions = new Map();
    this.initializers = new Map();
    this.storage = new AsyncLocalStorage();
  }

  registerFilter(event, handler) {
    return this.#register(this.filters, event, handler);
  }

  registerAction(event, handler) {
    return this.#register(this.actions, event, handler);
  }

  registerInit(event, handler) {
    return this.#register(this.initializers, event, handler);
  }

  #register(map, event, handler) {
    if (typeof event !== 'string' || event.trim() === '') throw new Error('Hook event is required');
    if (typeof handler !== 'function') throw new Error(`Hook handler for ${event} must be a function`);

    const name = event.trim();
    const handlers = map.get(name) ?? [];
    handlers.push(handler);
    map.set(name, handlers);

    return () => {
      const active = map.get(name) ?? [];
      const next = active.filter((candidate) => candidate !== handler);
      if (next.length === 0) map.delete(name);
      else map.set(name, next);
    };
  }

  #nextExecution(event) {
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
      events: [...(current?.events ?? []), event],
    };
  }

  async #runWithExecution(event, operation) {
    const execution = this.#nextExecution(event);
    return this.storage.run(execution, () => operation(execution));
  }

  async filter(event, payload, context = {}) {
    const handlers = this.filters.get(event) ?? [];
    if (handlers.length === 0) return payload;

    return this.#runWithExecution(event, async (execution) => {
      let current = payload;
      for (const handler of handlers) {
        const next = await handler(current, {
          ...context,
          hook: execution,
          event,
        });
        if (next !== undefined) current = next;
      }
      return current;
    });
  }

  async action(event, payload, context = {}) {
    const handlers = this.actions.get(event) ?? [];
    if (handlers.length === 0) return;

    await this.#runWithExecution(event, async (execution) => {
      for (const handler of handlers) {
        await handler(payload, {
          ...context,
          hook: execution,
          event,
        });
      }
    });
  }

  async init(event, context = {}) {
    const handlers = this.initializers.get(event) ?? [];
    if (handlers.length === 0) return;

    await this.#runWithExecution(`init:${event}`, async (execution) => {
      for (const handler of handlers) {
        await handler({
          ...context,
          hook: execution,
          event,
        });
      }
    });
  }
}
