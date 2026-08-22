import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { assertMaintenanceStartupAllowed } from '@yunsoft/yuncms-core';

export async function runStartCommand({
  env = process.env,
  cwd = process.cwd(),
  output = console,
  spawnProcess = spawn,
  signalSource = process,
} = {}) {
  await assertMaintenanceStartupAllowed({ cwd, env });

  const serverUrl = import.meta.resolve('@yunsoft/yuncms-api/server');
  const serverPath = fileURLToPath(serverUrl);

  output.log?.(`Starting YunCMS API from ${cwd}`);

  const child = spawnProcess(process.execPath, [serverPath], {
    cwd,
    env: { ...env },
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });

  return new Promise((resolve, reject) => {
    let forwardedSignal = null;
    const signalHandlers = new Map(
      ['SIGINT', 'SIGTERM'].map((signal) => [signal, () => {
        if (forwardedSignal || child.exitCode != null || child.signalCode != null) return;
        forwardedSignal = signal;
        child.kill(signal);
      }]),
    );
    const cleanup = () => {
      for (const [signal, handler] of signalHandlers) signalSource.off(signal, handler);
    };
    for (const [signal, handler] of signalHandlers) signalSource.on(signal, handler);

    child.once('error', (error) => {
      cleanup();
      error.code ||= 'API_START_FAILED';
      reject(error);
    });
    child.once('exit', (code, signal) => {
      cleanup();
      if (code === 0 || (signal && signal === forwardedSignal)) {
        resolve({ code: 0, signal });
        return;
      }
      const error = new Error(
        signal
          ? `YunCMS API exited after signal ${signal}`
          : `YunCMS API exited with code ${code}`,
      );
      error.code = 'API_EXITED';
      error.exitCode = code;
      error.signal = signal;
      reject(error);
    });
  });
}
