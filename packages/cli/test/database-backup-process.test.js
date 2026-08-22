import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  dumpDatabase,
  resolveDatabaseToolTimeoutMs,
  restoreDatabase,
} from '../src/database-backup.js';

const config = {
  host: '127.0.0.1', port: 3306, database: 'yuncms_test',
  user: 'yuncms', password: 'secret', ssl: false,
};

function fakeChild({ restore = false, signals = [] } = {}) {
  const child = new EventEmitter();
  child.stdout = restore ? null : new PassThrough();
  child.stdin = restore ? new PassThrough() : null;
  child.stderr = new PassThrough();
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === 'SIGKILL') {
      child.stdout?.end();
      child.stderr.end();
      queueMicrotask(() => child.emit('exit', null, 'SIGKILL'));
    }
    return true;
  };
  return child;
}

test('database tool timeout environment value is validated', () => {
  assert.equal(resolveDatabaseToolTimeoutMs({ YUNCMS_DB_TOOL_TIMEOUT_MS: '1234' }), 1234);
  assert.throws(
    () => resolveDatabaseToolTimeoutMs({ YUNCMS_DB_TOOL_TIMEOUT_MS: '0' }),
    (error) => error.code === 'DATABASE_TOOL_TIMEOUT_INVALID',
  );
});

test('mysqldump timeout terminates the child and fails with DATABASE_TOOL_TIMEOUT', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-dump-timeout-'));
  const signals = [];
  const child = fakeChild({ signals });
  try {
    await assert.rejects(
      dumpDatabase({
        config,
        outputPath: join(cwd, 'database.sql.gz'),
        timeoutMs: 20,
        killGraceMs: 10,
        spawnProcess() { return child; },
      }),
      (error) => error.code === 'DATABASE_TOOL_TIMEOUT'
        && error.command === 'mysqldump'
        && error.timeoutMs === 20,
    );
    assert.deepEqual(signals.slice(0, 2), ['SIGTERM', 'SIGKILL']);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('mysql restore timeout terminates the child after input streaming', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-restore-timeout-'));
  const signals = [];
  const child = fakeChild({ restore: true, signals });
  try {
    const inputPath = join(cwd, 'database.sql.gz');
    await writeFile(inputPath, gzipSync(Buffer.from('fixture-data\n')));
    await assert.rejects(
      restoreDatabase({
        config,
        inputPath,
        timeoutMs: 20,
        killGraceMs: 10,
        spawnProcess() { return child; },
      }),
      (error) => error.code === 'DATABASE_TOOL_TIMEOUT' && error.command === 'mysql',
    );
    assert.deepEqual(signals.slice(0, 2), ['SIGTERM', 'SIGKILL']);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
