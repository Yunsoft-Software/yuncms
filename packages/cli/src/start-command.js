import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function runStartCommand({
  env = process.env,
  cwd = process.cwd(),
  output = console,
  spawnProcess = spawn,
} = {}) {
  const serverUrl = import.meta.resolve('@yuncms/api/server');
  const serverPath = fileURLToPath(serverUrl);

  output.log?.(`Starting YunCMS API from ${cwd}`);

  const child = spawnProcess(process.execPath, [serverPath], {
    cwd,
    env: { ...env },
    stdio: 'inherit',
  });

  return new Promise((resolve, reject) => {
    child.once('error', (error) => {
      error.code ||= 'API_START_FAILED';
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (code === 0) {
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
