import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

const pending = new Map();
let sequence = 0;
function json(value) {
  const encoded = JSON.stringify(value ?? null, (_key, entry) => typeof entry === 'bigint' ? String(entry) : entry);
  if (Buffer.byteLength(encoded) > 262144) throw Object.assign(new Error('Script value exceeds 256 KiB'), { code: 'FLOW_OUTPUT_LIMIT', status: 400 });
  return JSON.parse(encoded);
}
function send(message) { process.send(message); }
function call(collection, method, args, emitEvents) {
  const id = ++sequence;
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  send({ type: 'call', id, collection, method, args: json(args), emitEvents });
  return promise;
}
function serializeError(error) {
  return { code: typeof error.code === 'string' ? error.code.slice(0, 100) : 'FLOW_SCRIPT_ERROR',
    message: String(error.message ?? 'Script failed').slice(0, 1000), status: Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 400 };
}
process.on('message', async message => {
  if (message.type === 'reply') {
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(Object.assign(new Error(message.error.message), message.error));
    else request.resolve(message.value);
    return;
  }
  if (message.type !== 'start') return;
  try {
    new Worker(new URL('./script-watchdog.js', import.meta.url), { workerData: { parentPid: process.ppid, timeoutMs: message.timeoutMs }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 16 } }).unref();
    const log = value => send({ type: 'log', value: json(value) });
    for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = (...values) => log(values);
    const context = Object.freeze({ accountability: Object.freeze(message.accountability), requestId: message.requestId, env: message.env, log,
      items(collection, options = {}) {
        return Object.freeze(Object.fromEntries(['readOne', 'readMany', 'createOne', 'createMany', 'updateOne', 'deleteOne']
          .map(method => [method, (...args) => call(collection, method, args, options.emit_events === true)])));
      },
    });
    const module = await import(pathToFileURL(message.modulePath).href);
    if (typeof module.default !== 'function') throw Object.assign(new Error('Export a default function, or module.exports in CommonJS mode'), { code: 'FLOW_SCRIPT_EXPORT_INVALID', status: 400 });
    const result = await module.default(message.data, context);
    send({ type: 'result', value: json(result) });
  } catch (error) { send({ type: 'failure', error: serializeError(error) }); }
});
