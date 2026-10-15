import { fork } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { assertFlowJson, flowError, FLOW_LIMITS } from './definition.js';
import { flowExecutionStorage, withFlowEvents } from './context.js';
import { redactAuditValue } from '../services/audit-service.js';

let activeScripts = 0;
export const SCRIPT_DEFAULTS = Object.freeze({ enabled: false, timeoutMs: 5000, memoryMb: 128, concurrency: 2 });

export function validateScriptOptions(options) {
  if (typeof options.code !== 'string' || !options.code.trim() || Buffer.byteLength(options.code) > 65536 || !['module', 'commonjs'].includes(options.format ?? 'module')) throw flowError('INVALID_FLOW', 'Provide a JavaScript function up to 64 KiB in module or CommonJS format');
  if (Object.keys(options).some(key => !['code', 'format'].includes(key))) throw flowError('INVALID_FLOW', 'Script supports code and format only');
}
function safeValue(value) {
  const text = JSON.stringify(value ?? null, (_key, entry) => typeof entry === 'bigint' ? String(entry) : entry);
  if (Buffer.byteLength(text) > FLOW_LIMITS.bytes) throw flowError('FLOW_OUTPUT_LIMIT', 'Script value exceeds 256 KiB');
  const result = JSON.parse(text); assertFlowJson(result); return result;
}
function clientError(error) {
  return { code: error.code ?? 'FLOW_OPERATION_FAILED', status: error.status ?? (['FORBIDDEN', 'FORBIDDEN_FIELD'].includes(error.code) ? 403 : 400), message: error.status >= 500 ? 'Native operation failed' : String(error.message).slice(0, 1000) };
}
async function nativeCall(message, context) {
  const { collection, method, emitEvents } = message, args = safeValue(message.args);
  const entry = Object.hasOwn(context.schema.collections, collection) ? context.schema.collections[collection] : null;
  if (!entry || entry.system || !['readOne', 'readMany', 'createOne', 'createMany', 'updateOne', 'deleteOne'].includes(method) || !Array.isArray(args)) throw flowError('INVALID_FLOW_OPERATION', 'Script data calls require a project collection and supported native method');
  if (method === 'createMany' && (!Array.isArray(args[0]) || args[0].length < 1 || args[0].length > 100)) throw flowError('INVALID_FLOW_OPERATION', 'Script createMany supports 1 to 100 items');
  if (method === 'readMany') args[0] = { ...args[0], limit: Math.min(Number(args[0]?.limit) || 100, 100) };
  const service = new context.services.ItemsService(collection, context);
  return withFlowEvents(emitEvents === true, async () => safeValue(await service[method](...args)));
}

export async function executeFlowScript(options, data, context) {
  validateScriptOptions(options);
  const config = { ...SCRIPT_DEFAULTS, ...context.scripts };
  if (config.enabled !== true) throw flowError('FLOW_SCRIPT_DISABLED', 'Enable trusted server scripts before using Run script', 409);
  if (activeScripts >= config.concurrency) throw flowError('FLOW_SCRIPT_BUSY', 'All script execution slots are busy', 429);
  activeScripts++;
  let directory;
  try {
    const project = resolve(config.projectPath ?? process.cwd()), root = join(project, '.yuncms', 'flow-scripts');
    await mkdir(root, { recursive: true, mode: 0o700 }); directory = await mkdtemp(join(root, 'run-'));
    const modulePath = join(directory, options.format === 'commonjs' ? 'operation.cjs' : 'operation.mjs');
    await writeFile(modulePath, options.code, { mode: 0o600 });
    if (context.signal?.aborted) throw flowError('FLOW_TIMEOUT', 'Flow execution deadline exceeded', 504);
    const input = safeValue(data), actor = safeValue(context.accountability), environment = safeValue(context.env ?? {});
    const child = fork(new URL('./script-worker.js', import.meta.url), [], { cwd: project,
      execArgv: [`--max-old-space-size=${config.memoryMb}`], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: process.platform !== 'win32' });
    const closed = new Promise(resolve => child.once('close', resolve));
    const inflight = new Set(), execution = flowExecutionStorage.getStore();
    return await new Promise((resolve, reject) => {
      let finishing = false, calls = 0, messages = 0;
      const finish = async (error, value) => {
        if (finishing) return; finishing = true; clearTimeout(timer); context.signal?.removeEventListener('abort', abort);
        try { if (child.pid) { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } } catch {}
        await closed;
        // Drain native work before returning, so a blocking flow can roll back its original transaction safely.
        await Promise.allSettled([...inflight]);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => { void finish(flowError('FLOW_TIMEOUT', 'Flow execution deadline exceeded', 504)); };
      const send = message => {
        if (finishing || !child.connected) return;
        try { child.send(message, error => { if (error) void finish(flowError('FLOW_SCRIPT_EXIT', 'Script process disconnected', 500)); }); }
        catch { void finish(flowError('FLOW_SCRIPT_EXIT', 'Script process disconnected', 500)); }
      };
      const timer = setTimeout(() => { void finish(flowError('FLOW_SCRIPT_TIMEOUT', 'Script execution deadline exceeded', 504)); }, config.timeoutMs);
      context.signal?.addEventListener('abort', abort, { once: true });
      child.on('error', () => { void finish(flowError('FLOW_SCRIPT_START_FAILED', 'Script process could not start', 503)); });
      child.once('exit', () => { if (!finishing) void finish(flowError('FLOW_SCRIPT_EXIT', 'Script process exited without a result', 500)); });
      child.on('message', message => {
        if (finishing) return;
        if (!message || typeof message !== 'object') { void finish(flowError('FLOW_SCRIPT_PROTOCOL', 'Invalid script process message')); return; }
        if (++messages > 220) { void finish(flowError('FLOW_SCRIPT_CALL_LIMIT', 'Script message limit reached')); return; }
        if (message.type === 'result') { try { void finish(null, safeValue(message.value)); } catch (error) { void finish(error); } return; }
        if (message.type === 'failure') { void finish(flowError(message.error.code, message.error.message, message.error.status)); return; }
        if (message.type === 'log') {
          try { const value = redactAuditValue(safeValue(message.value)); context.logger?.info?.('YunCMS flow script message', { flow: context.flow?.id, message: JSON.stringify(value).length > 65536 ? { truncated: true } : value }); }
          catch (error) { void finish(error); }
          return;
        }
        if (message.type !== 'call' || ++calls > 100 || inflight.size >= 16) { void finish(flowError('FLOW_SCRIPT_CALL_LIMIT', 'Script supports 100 native calls and 16 concurrent calls')); return; }
        const work = flowExecutionStorage.run(execution, () => nativeCall(message, context))
          .then(value => { send({ type: 'reply', id: message.id, value }); }, error => { send({ type: 'reply', id: message.id, error: clientError(error) }); })
          .finally(() => inflight.delete(work));
        inflight.add(work);
      });
      send({ type: 'start', modulePath, data: input, accountability: actor, requestId: context.requestId ?? null, env: environment, timeoutMs: config.timeoutMs });
    });
  } finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    catch (error) { context.logger?.warn?.('Flow script cleanup failed', { code: error.code }); }
    activeScripts--;
  }
}
