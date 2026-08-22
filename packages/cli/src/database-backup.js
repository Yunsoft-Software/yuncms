import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

const MAX_STDERR_BYTES = 64 * 1024;
export const DEFAULT_DATABASE_TOOL_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MAX_DATABASE_TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 5_000;

function delay(ms) {
  return new Promise((resolveDelay) => {
    const handle = setTimeout(resolveDelay, ms);
    handle.unref?.();
  });
}

function databaseArgs(config, { dump = false } = {}) {
  const args = [
    '--protocol=TCP',
    `--host=${config.host}`,
    `--port=${config.port}`,
    `--user=${config.user}`,
    '--default-character-set=utf8mb4',
  ];

  if (config.ssl) args.push('--ssl-mode=REQUIRED');
  if (dump) {
    args.push(
      '--single-transaction',
      '--quick',
      '--hex-blob',
      '--triggers',
      '--no-tablespaces',
    );
  }

  args.push(config.database);
  return args;
}

function childEnvironment(config, env = process.env) {
  return {
    ...env,
    MYSQL_PWD: config.password,
  };
}

function positiveInteger(value, code, label, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    const error = new Error(`${label} must be an integer between 1 and ${max}`);
    error.code = code;
    throw error;
  }
  return parsed;
}

export function resolveDatabaseToolTimeoutMs(env = process.env, explicitTimeoutMs = null) {
  const value = explicitTimeoutMs ?? env.YUNCMS_DB_TOOL_TIMEOUT_MS ?? DEFAULT_DATABASE_TOOL_TIMEOUT_MS;
  return positiveInteger(
    value,
    'DATABASE_TOOL_TIMEOUT_INVALID',
    'YunCMS database tool timeout',
    MAX_DATABASE_TOOL_TIMEOUT_MS,
  );
}

function collectStderr(stream) {
  let stderr = '';
  stream?.setEncoding?.('utf8');
  stream?.on?.('data', (chunk) => {
    if (stderr.length >= MAX_STDERR_BYTES) return;
    stderr += String(chunk).slice(0, MAX_STDERR_BYTES - stderr.length);
  });
  return () => stderr.trim();
}

function databaseTimeoutError(command, timeoutMs, readStderr) {
  const detail = readStderr();
  const error = new Error(
    `${command} exceeded the ${timeoutMs}ms YunCMS database tool timeout${detail ? `: ${detail}` : ''}`,
  );
  error.code = 'DATABASE_TOOL_TIMEOUT';
  error.command = command;
  error.timeoutMs = timeoutMs;
  error.stderr = detail;
  return error;
}

function waitForChild(child, command, readStderr, { timeoutMs, killGraceMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let timeoutHandle = null;
    let forceKillHandle = null;
    let forceRejectHandle = null;

    function clearTimers() {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (forceKillHandle) clearTimeout(forceKillHandle);
      if (forceRejectHandle) clearTimeout(forceRejectHandle);
    }

    function finish(callback) {
      if (settled) return;
      settled = true;
      clearTimers();
      callback();
    }

    function requestKill(signal) {
      try {
        child.kill?.(signal);
      } catch {
        // The bounded timeout path still rejects if signalling the child handle fails.
      }
    }

    timeoutHandle = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      requestKill('SIGTERM');
      forceKillHandle = setTimeout(() => {
        if (settled) return;
        requestKill('SIGKILL');
        forceRejectHandle = setTimeout(() => {
          finish(() => reject(databaseTimeoutError(command, timeoutMs, readStderr)));
        }, killGraceMs);
        forceRejectHandle.unref?.();
      }, killGraceMs);
      forceKillHandle.unref?.();
    }, timeoutMs);
    timeoutHandle.unref?.();

    child.once('error', (error) => {
      finish(() => {
        if (timedOut) {
          reject(databaseTimeoutError(command, timeoutMs, readStderr));
          return;
        }
        error.code ||= 'BACKUP_PROCESS_START_FAILED';
        error.command = command;
        reject(error);
      });
    });

    child.once('exit', (code, signal) => {
      finish(() => {
        if (timedOut) {
          const error = databaseTimeoutError(command, timeoutMs, readStderr);
          error.exitCode = code;
          error.signal = signal;
          reject(error);
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }
        const detail = readStderr();
        const error = new Error(
          `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}${detail ? `: ${detail}` : ''}`,
        );
        error.code = 'BACKUP_PROCESS_FAILED';
        error.command = command;
        error.exitCode = code;
        error.signal = signal;
        error.stderr = detail;
        reject(error);
      });
    });
  });
}

async function terminateChild(child, childPromise, killGraceMs) {
  let settled = false;
  const observedChild = childPromise.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  try {
    child.kill?.('SIGTERM');
  } catch {
    // Continue to bounded wait/SIGKILL.
  }
  await Promise.race([observedChild, delay(killGraceMs)]);
  if (settled) return;

  try {
    child.kill?.('SIGKILL');
  } catch {
    // The caller will still receive the original pipeline error.
  }
  await Promise.race([observedChild, delay(killGraceMs)]);
}

async function runDatabasePipeline({ child, command, streamPromise, timeoutMs, killGraceMs, readStderr }) {
  const childPromise = waitForChild(child, command, readStderr, { timeoutMs, killGraceMs });
  let streamFailed = false;
  const observedStream = streamPromise.catch((error) => {
    streamFailed = true;
    throw error;
  });

  try {
    await Promise.all([childPromise, observedStream]);
  } catch (error) {
    if (streamFailed) await terminateChild(child, childPromise, killGraceMs);
    throw error;
  }
}

function spawnDatabaseProcess(spawnProcess, command, args, options) {
  try {
    return spawnProcess(command, args, options);
  } catch (error) {
    error.code ||= 'BACKUP_PROCESS_START_FAILED';
    error.command = command;
    throw error;
  }
}

export function buildDatabaseClientArgs(config, options = {}) {
  return databaseArgs(config, options);
}

export async function dumpDatabase({
  config,
  outputPath,
  env = process.env,
  spawnProcess = spawn,
  timeoutMs = null,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
} = {}) {
  if (!config || !outputPath) throw new Error('Database config and output path are required');
  const resolvedTimeoutMs = resolveDatabaseToolTimeoutMs(env, timeoutMs);
  const resolvedKillGraceMs = positiveInteger(
    killGraceMs,
    'DATABASE_TOOL_KILL_GRACE_INVALID',
    'Database tool kill grace period',
    60_000,
  );

  const child = spawnDatabaseProcess(
    spawnProcess,
    'mysqldump',
    databaseArgs(config, { dump: true }),
    {
      env: childEnvironment(config, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const readStderr = collectStderr(child.stderr);
  const streamPromise = pipeline(
    child.stdout,
    createGzip({ level: 6 }),
    createWriteStream(outputPath, { mode: 0o600 }),
  );

  await runDatabasePipeline({
    child,
    command: 'mysqldump',
    streamPromise,
    timeoutMs: resolvedTimeoutMs,
    killGraceMs: resolvedKillGraceMs,
    readStderr,
  });

  return outputPath;
}

export async function verifyDatabaseDump({ inputPath } = {}) {
  if (!inputPath) throw new Error('Database dump path is required');
  let decompressedBytes = 0;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      decompressedBytes += chunk.length;
      callback();
    },
  });

  try {
    await pipeline(createReadStream(inputPath), createGunzip(), sink);
  } catch (error) {
    const invalid = new Error(`Database backup is not a valid gzip stream: ${inputPath}`);
    invalid.code = 'BACKUP_DATABASE_INVALID';
    invalid.cause = error;
    throw invalid;
  }

  if (decompressedBytes === 0) {
    const error = new Error(`Database backup decompressed to an empty dump: ${inputPath}`);
    error.code = 'BACKUP_DATABASE_EMPTY';
    throw error;
  }

  return { decompressedBytes };
}

export async function restoreDatabase({
  config,
  inputPath,
  env = process.env,
  spawnProcess = spawn,
  timeoutMs = null,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
} = {}) {
  if (!config || !inputPath) throw new Error('Database config and input path are required');
  const resolvedTimeoutMs = resolveDatabaseToolTimeoutMs(env, timeoutMs);
  const resolvedKillGraceMs = positiveInteger(
    killGraceMs,
    'DATABASE_TOOL_KILL_GRACE_INVALID',
    'Database tool kill grace period',
    60_000,
  );

  const child = spawnDatabaseProcess(
    spawnProcess,
    'mysql',
    databaseArgs(config),
    {
      env: childEnvironment(config, env),
      stdio: ['pipe', 'ignore', 'pipe'],
    },
  );
  const readStderr = collectStderr(child.stderr);
  const streamPromise = pipeline(createReadStream(inputPath), createGunzip(), child.stdin);

  await runDatabasePipeline({
    child,
    command: 'mysql',
    streamPromise,
    timeoutMs: resolvedTimeoutMs,
    killGraceMs: resolvedKillGraceMs,
    readStderr,
  });

  return true;
}
