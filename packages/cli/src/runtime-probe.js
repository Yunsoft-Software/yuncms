import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { MAINTENANCE_BYPASS_ENV } from '@yunsoft/yuncms-core';

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function probeError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

export async function verifyInstalledRuntime({
  cwd = process.cwd(),
  env = process.env,
  port,
  maintenanceBypassToken = null,
  fetchFn = globalThis.fetch,
  spawnProcess = spawn,
  timeoutMs = 15_000,
  shutdownGraceMs = 3_000,
} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw probeError('UPDATE_PROBE_PORT_INVALID', `Invalid probe port: ${port}`);
  }
  if (typeof fetchFn !== 'function') {
    throw probeError('UPDATE_PROBE_FETCH_UNAVAILABLE', 'Runtime probe requires fetch support');
  }
  if (maintenanceBypassToken !== null && (typeof maintenanceBypassToken !== 'string' || maintenanceBypassToken.length < 32)) {
    throw probeError('UPDATE_PROBE_MAINTENANCE_TOKEN_INVALID', 'Runtime probe maintenance bypass token is invalid');
  }
  if (!Number.isInteger(shutdownGraceMs) || shutdownGraceMs < 1 || shutdownGraceMs > 30_000) {
    throw probeError(
      'UPDATE_PROBE_SHUTDOWN_GRACE_INVALID',
      `Runtime probe shutdown grace must be an integer between 1 and 30000ms: ${shutdownGraceMs}`,
    );
  }

  const cliPath = resolve(cwd, 'node_modules', '@yunsoft', 'yuncms', 'bin', 'yuncms.js');
  const origin = `http://127.0.0.1:${port}`;
  const childEnv = {
    ...env,
    HOST: '127.0.0.1',
    PORT: String(port),
    STUDIO_ORIGIN: origin,
    AUTH_PUBLIC_URL: origin,
  };
  if (maintenanceBypassToken !== null) childEnv[MAINTENANCE_BYPASS_ENV] = maintenanceBypassToken;

  const child = spawnProcess(process.execPath, [cliPath, 'start'], {
    cwd,
    env: childEnv,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderr = '';
  child.stderr?.setEncoding?.('utf8');
  child.stderr?.on?.('data', (chunk) => {
    if (stderr.length < 64 * 1024) stderr += String(chunk).slice(0, (64 * 1024) - stderr.length);
  });

  let settled = false;
  let shutdownAttempted = false;
  const exitPromise = new Promise((resolveExit, rejectExit) => {
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      error.code ||= 'UPDATE_PROBE_START_FAILED';
      rejectExit(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      resolveExit({ code, signal });
    });
  });

  function requestKill(signal) {
    try {
      child.kill(signal);
    } catch {
      // The bounded shutdown path still escalates and reports a timeout.
    }
  }

  async function waitForExit() {
    return new Promise((resolveWait, rejectWait) => {
      const timeout = setTimeout(() => {
        resolveWait({ exited: false, result: null });
      }, shutdownGraceMs);
      exitPromise.then(
        (result) => {
          clearTimeout(timeout);
          resolveWait({ exited: true, result });
        },
        (error) => {
          clearTimeout(timeout);
          rejectWait(error);
        },
      );
    });
  }

  async function stopProbe({ strict }) {
    shutdownAttempted = true;
    requestKill('SIGTERM');
    let outcome = await waitForExit();
    if (outcome.exited) return outcome.result;

    requestKill('SIGKILL');
    outcome = await waitForExit();
    if (outcome.exited) return outcome.result;
    if (!strict) return null;
    throw probeError(
      'UPDATE_PROBE_SHUTDOWN_TIMEOUT',
      `Updated YunCMS did not stop within ${shutdownGraceMs * 2}ms after readiness`,
    );
  }

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const earlyExit = await Promise.race([
        exitPromise.then((result) => ({ type: 'exit', result })),
        delay(200).then(() => ({ type: 'tick' })),
      ]);
      if (earlyExit.type === 'exit') {
        throw probeError(
          'UPDATE_PROBE_EXITED',
          `Updated YunCMS exited before readiness${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
          earlyExit.result,
        );
      }

      try {
        const response = await fetchFn(`${origin}/ready`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          const body = await response.json().catch(() => null);
          if (body?.status === 'ready') {
            const result = await stopProbe({ strict: true });
            if (result.code !== 0 && result.signal !== 'SIGTERM') {
              throw probeError('UPDATE_PROBE_SHUTDOWN_FAILED', 'Updated runtime did not stop cleanly', result);
            }
            return { ready: true, origin };
          }
        }
      } catch (error) {
        if (error?.code?.startsWith?.('UPDATE_PROBE_')) throw error;
      }
    }

    throw probeError(
      'UPDATE_PROBE_TIMEOUT',
      `Updated YunCMS did not become ready within ${timeoutMs}ms${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
    );
  } finally {
    if (!settled && !shutdownAttempted) {
      await stopProbe({ strict: false }).catch(() => null);
    }
  }
}
