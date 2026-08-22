import { spawn } from 'node:child_process';

const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

function appendBounded(current, chunk, maxBytes) {
  if (Buffer.byteLength(current) >= maxBytes) return current;
  const remaining = maxBytes - Buffer.byteLength(current);
  const value = Buffer.from(String(chunk));
  return current + value.subarray(0, remaining).toString('utf8');
}

export async function runCapturedProcess(command, args = [], {
  cwd = process.cwd(),
  env = process.env,
  spawnProcess = spawn,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
} = {}) {
  const child = spawnProcess(command, args, {
    cwd,
    env: { ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding?.('utf8');
  child.stderr?.setEncoding?.('utf8');
  child.stdout?.on?.('data', (chunk) => {
    stdout = appendBounded(stdout, chunk, maxOutputBytes);
  });
  child.stderr?.on?.('data', (chunk) => {
    stderr = appendBounded(stderr, chunk, maxOutputBytes);
  });

  return new Promise((resolve, reject) => {
    child.once('error', (error) => {
      error.code ||= 'COMMAND_START_FAILED';
      error.command = command;
      error.args = [...args];
      reject(error);
    });
    child.once('exit', (code, signal) => {
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
}
