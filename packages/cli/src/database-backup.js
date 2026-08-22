import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

const MAX_STDERR_BYTES = 64 * 1024;

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

function collectStderr(stream) {
  let stderr = '';
  stream?.setEncoding?.('utf8');
  stream?.on?.('data', (chunk) => {
    if (stderr.length >= MAX_STDERR_BYTES) return;
    stderr += String(chunk).slice(0, MAX_STDERR_BYTES - stderr.length);
  });
  return () => stderr.trim();
}

function waitForChild(child, command, readStderr) {
  return new Promise((resolve, reject) => {
    child.once('error', (error) => {
      error.code ||= 'BACKUP_PROCESS_START_FAILED';
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = readStderr();
      const error = new Error(
        `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}${detail ? `: ${detail}` : ''}`,
      );
      error.code = 'BACKUP_PROCESS_FAILED';
      error.exitCode = code;
      error.signal = signal;
      reject(error);
    });
  });
}

export function buildDatabaseClientArgs(config, options = {}) {
  return databaseArgs(config, options);
}

export async function dumpDatabase({
  config,
  outputPath,
  env = process.env,
  spawnProcess = spawn,
} = {}) {
  if (!config || !outputPath) throw new Error('Database config and output path are required');

  const child = spawnProcess('mysqldump', databaseArgs(config, { dump: true }), {
    env: childEnvironment(config, env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const readStderr = collectStderr(child.stderr);

  await Promise.all([
    waitForChild(child, 'mysqldump', readStderr),
    pipeline(child.stdout, createGzip({ level: 6 }), createWriteStream(outputPath, { mode: 0o600 })),
  ]);

  return outputPath;
}

export async function restoreDatabase({
  config,
  inputPath,
  env = process.env,
  spawnProcess = spawn,
} = {}) {
  if (!config || !inputPath) throw new Error('Database config and input path are required');

  const child = spawnProcess('mysql', databaseArgs(config), {
    env: childEnvironment(config, env),
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  const readStderr = collectStderr(child.stderr);

  await Promise.all([
    waitForChild(child, 'mysql', readStderr),
    pipeline(createReadStream(inputPath), createGunzip(), child.stdin),
  ]);

  return true;
}
