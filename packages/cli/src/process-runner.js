import { spawn } from 'node:child_process';

const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
export const DEFAULT_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_COMMAND_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 5_000;

function appendBounded(current, chunk, maxBytes) {
  if (Buffer.byteLength(current) >= maxBytes) return current;
  const remaining = maxBytes - Buffer.byteLength(current);
  const value = Buffer.from(String(chunk));
  return current + value.subarray(0, remaining).toString('utf8');
}

function positiveInteger(value, code, label, { max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    const error = new Error(`${label} must be an integer between 1 and ${max}`);
    error.code = code;
    throw error;
  }
  return parsed;
}

export function resolveCommandTimeoutMs(env = process.env, explicitTimeoutMs = null) {
  const value = explicitTimeoutMs ?? env.YUNCMS_CLI_COMMAND_TIMEOUT_MS ?? DEFAULT_COMMAND_TIMEOUT_MS;
  return positiveInteger(
    value,
    'COMMAND_TIMEOUT_INVALID',
    'YunCMS CLI command timeout',
    { max: MAX_COMMAND_TIMEOUT_MS },
  );
}

function timeoutError(command, args, timeoutMs, stdout, stderr) {
  const error = new Error(`${command} ${args.join(' ')} exceeded the ${timeoutMs}ms YunCMS CLI command timeout`);
  error.code = 'COMMAND_TIMEOUT';
  error.command = command;
  error.args = [...args];
  error.timeoutMs = timeoutMs;
  error.stdout = stdout.trim();
  error.stderr = stderr.trim();
  return error;
}

function spawnCapturedProcess(spawnProcess, command, args, options) {
  try {
    return spawnProcess(command, args, options);
  } catch (error) {
    error.code ||= 'COMMAND_START_FAILED';
    error.command = command;
    error.args = [...args];
    throw error;
  }
}

export async function runCapturedProcess(command, args = [], {
  cwd = process.cwd(),
  env = process.env,
  spawnProcess = spawn,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  timeoutMs = null,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
} = {}) {
  const resolvedTimeoutMs = resolveCommandTimeoutMs(env, timeoutMs);
  const resolvedKillGraceMs = positiveInteger(
    killGraceMs,
    'COMMAND_KILL_GRACE_INVALID',
    'Command kill grace period',
    { max: 60_000 },
  );
  const resolvedMaxOutputBytes = positiveInteger(
    maxOutputBytes,
    'COMMAND_MAX_OUTPUT_INVALID',
    'Command output limit',
    { max: 16 * 1024 * 1024 },
  );

  const child = spawnCapturedProcess(
    spawnProcess,
    command,
    args,
    {
      cwd,
      env: { ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding?.('utf8');
  child.stderr?.setEncoding?.('utf8');
  child.stdout?.on?.('data', (chunk) => {
    stdout = appendBounded(stdout, chunk, resolvedMaxOutputBytes);
  });
  child.stderr?.on?.('data', (chunk) => {
    stderr = appendBounded(stderr, chunk, resolvedMaxOutputBytes);
  });

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
        // The timeout path still rejects even when the child handle cannot be signalled.
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
          finish(() => reject(timeoutError(command, args, resolvedTimeoutMs, stdout, stderr)));
        }, resolvedKillGraceMs);
        forceRejectHandle.unref?.();
      }, resolvedKillGraceMs);
      forceKillHandle.unref?.();
    }, resolvedTimeoutMs);
    timeoutHandle.unref?.();

    child.once('error', (error) => {
      finish(() => {
        if (timedOut) {
          reject(timeoutError(command, args, resolvedTimeoutMs, stdout, stderr));
          return;
        }
        error.code ||= 'COMMAND_START_FAILED';
        error.command = command;
        error.args = [...args];
        reject(error);
      });
    });

    child.once('exit', (code, signal) => {
      finish(() => {
        if (timedOut) {
          const error = timeoutError(command, args, resolvedTimeoutMs, stdout, stderr);
          error.exitCode = code;
          error.signal = signal;
          reject(error);
          return;
        }
        if (code === 0) {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: 0, signal: null });
          return;
        }

        const detail = stderr.trim() || stdout.trim();
        const error = new Error(
          `${command} ${args.join(' ')} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}${detail ? `: ${detail}` : ''}`,
        );
        error.code = 'COMMAND_FAILED';
        error.command = command;
        error.args = [...args];
        error.exitCode = code;
        error.signal = signal;
        error.stdout = stdout.trim();
        error.stderr = stderr.trim();
        reject(error);
      });
    });
  });
}
