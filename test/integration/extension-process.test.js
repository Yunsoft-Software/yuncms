import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ApiTokensService,
  bootstrapDatabase,
  closeDatabasePool,
  createDatabasePool,
  createSystemAccountability,
  loadConfig,
  quoteIdentifier,
  RolesService,
  UsersService,
} from '@yunsoft/yuncms-core';

const ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER_ENTRY = join(ROOT, 'packages/api/src/server.js');

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(-12);
}

function safeName(prefix, runId) {
  const value = `${prefix}_${runId}`;
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw new Error(`Unsafe integration identifier: ${value}`);
  return value;
}

function requireDisposableDatabase(config) {
  if (!DESTRUCTIVE) throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required');
  if (!/(test|ci|dev)/i.test(config.database.database)) {
    throw new Error(`Integration DB name must contain test, ci or dev: ${config.database.database}`);
  }
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const reservation = createNetServer();
    reservation.listen(0, '127.0.0.1', () => {
      const port = reservation.address().port;
      reservation.close((error) => (error ? reject(error) : resolvePort(port)));
    });
    reservation.once('error', reject);
  });
}

function wait(ms, { unref = false } = {}) {
  return new Promise((resolveWait) => {
    const timer = setTimeout(resolveWait, ms);
    if (unref) timer.unref();
  });
}

function startApi(cwd, port, env) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd,
    env: { ...process.env, ...env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  const capture = (chunk) => {
    output.push(chunk.toString('utf8'));
    if (output.length > 200) output.shift();
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const exited = new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })));
  return { child, exited, output, port };
}

async function waitForReady(processInfo, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processInfo.child.exitCode != null) {
      throw new Error(`API process exited before readiness:\n${processInfo.output.join('')}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${processInfo.port}/ready`);
      if (response.status === 200) return;
    } catch {}
    await wait(100);
  }
  throw new Error(`API process did not become ready:\n${processInfo.output.join('')}`);
}

async function stopApi(processInfo) {
  if (!processInfo || processInfo.child.exitCode != null) return;
  processInfo.child.kill('SIGTERM');
  const result = await Promise.race([
    processInfo.exited,
    wait(11_000, { unref: true }).then(() => null),
  ]);
  if (!result) {
    processInfo.child.kill('SIGKILL');
    await processInfo.exited;
    throw new Error(`API process exceeded shutdown budget:\n${processInfo.output.join('')}`);
  }
  assert.equal(result.code, 0, `API process shutdown failed:\n${processInfo.output.join('')}`);
}

async function createExtensionProject(extensionId, source) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'yuncms-extension-process-'));
  const extensionRoot = join(projectRoot, 'extensions', extensionId);
  await mkdir(extensionRoot, { recursive: true });
  await writeFile(join(projectRoot, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
  await writeFile(join(extensionRoot, 'package.json'), `${JSON.stringify({
    name: `yuncms-extension-${extensionId}`,
    version: '1.0.0',
    type: 'module',
    yuncms: { id: extensionId, type: 'hook', entry: './index.js' },
  }, null, 2)}\n`);
  await writeFile(join(extensionRoot, 'index.js'), source);
  return projectRoot;
}

async function createAdmin(pool, runId) {
  const system = createSystemAccountability();
  const role = await new RolesService({ accountability: system, database: pool }).createOne({
    name: `Extension Admin ${runId}`,
    admin: true,
  });
  const user = await new UsersService({ accountability: system, database: pool }).createOne({
    email: `extension-admin-${runId}@example.test`,
    password: `Extension-Admin-${runId}!`,
    role: role.id,
    status: 'active',
    emailVerified: true,
  });
  const token = await new ApiTokensService({ accountability: system, database: pool }).createOne({
    user: user.id,
    name: `extension-${runId}`,
  });
  return { role, user, token };
}

function serverEnv(config, storageRoot) {
  return {
    DB_HOST: config.database.host,
    DB_PORT: String(config.database.port),
    DB_DATABASE: config.database.database,
    DB_USER: config.database.user,
    DB_PASSWORD: config.database.password,
    DB_SSL: config.database.ssl ? 'true' : 'false',
    FILES_LOCAL_ROOT: storageRoot,
    API_RATE_LIMIT_ENABLED: 'false',
    PRESSURE_LIMIT_ENABLED: 'false',
    LOG_LEVEL: 'warn',
  };
}

async function jsonRequest(port, token, path, { body, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = response.status === 204 ? '' : await response.text();
  return { response, payload: text ? JSON.parse(text) : null };
}

test('real schema mutations emit ordered post-success events and compensate a failed field mutation', {
  skip: !ENABLED,
  timeout: 120_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);
  const runId = suffix();
  const eventsTable = safeName('it_schema_events', runId);
  const failureConstraint = safeName('it_schema_check', runId);
  const names = {
    left: safeName('it_evt_left', runId),
    right: safeName('it_evt_right', runId),
    one: safeName('it_evt_one', runId),
    junction: safeName('it_evt_join', runId),
  };
  const quotedEvents = quoteIdentifier(eventsTable, 'integration events table');
  const quotedFailureConstraint = quoteIdentifier(failureConstraint, 'integration check constraint');
  const storageRoot = await mkdtemp(join(tmpdir(), 'yuncms-extension-storage-'));
  let projectRoot;
  let processInfo;
  let admin;
  let failureConstraintCreated = false;

  try {
    await bootstrapDatabase(pool);
    await pool.query(
      `CREATE TABLE ${quotedEvents} (
        seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        event_name VARCHAR(80) NOT NULL,
        item_key VARCHAR(191) NULL,
        collection_name VARCHAR(191) NULL,
        broad_event VARCHAR(80) NULL
      ) ENGINE=InnoDB`,
    );

    const source = `
export default {
  __yuncms_extension__: true,
  type: 'hook',
  register({ action, init }, context) {
    init('app.beforeStart', async () => {
      await context.database.query(
        'INSERT INTO ${eventsTable} (event_name, item_key, collection_name, broad_event) VALUES (?, ?, ?, ?)',
        ['extension.env', context.env.EXTENSION_RUNTIME_PROBE ?? null, null, null],
      );
    });
    for (const event of ['schema.collection.create', 'schema.field.create', 'schema.relation.create', 'schema.changed']) {
      action(event, async (payload, { database }) => {
        await database.query(
          'INSERT INTO ${eventsTable} (event_name, item_key, collection_name, broad_event) VALUES (?, ?, ?, ?)',
          [event, payload?.key ?? null, payload?.collection ?? null, payload?.event ?? null],
        );
      });
    }
  },
};
`;
    projectRoot = await createExtensionProject(`schema-${runId}`, source);
    admin = await createAdmin(pool, runId);
    const port = await availablePort();
    processInfo = startApi(projectRoot, port, {
      ...serverEnv(config, storageRoot),
      STUDIO_ORIGIN: `http://127.0.0.1:${port}`,
      EXTENSION_RUNTIME_PROBE: `extension-process-${runId}`,
    });
    await waitForReady(processInfo);
    const token = admin.token.token;

    for (const collection of [names.left, names.right, names.one]) {
      const created = await jsonRequest(port, token, '/schema/collections', {
        method: 'POST', body: { collection },
      });
      assert.equal(created.response.status, 201);
    }
    for (const [collection, field] of [[names.left, 'many_id'], [names.one, 'one_id']]) {
      const created = await jsonRequest(port, token, `/schema/collections/${collection}/fields`, {
        method: 'POST', body: { field, type: 'uuid', required: false },
      });
      assert.equal(created.response.status, 201);
    }

    const m2o = await jsonRequest(port, token, '/schema/relations/m2o', {
      method: 'POST',
      body: { manyCollection: names.left, manyField: 'many_id', oneCollection: names.right, onDelete: 'SET NULL' },
    });
    assert.equal(m2o.response.status, 201);
    const o2o = await jsonRequest(port, token, '/schema/relations/o2o', {
      method: 'POST',
      body: { manyCollection: names.one, manyField: 'one_id', oneCollection: names.right, onDelete: 'SET NULL' },
    });
    assert.equal(o2o.response.status, 201);
    const m2m = await jsonRequest(port, token, '/schema/relations/m2m', {
      method: 'POST',
      body: { junctionCollection: names.junction, leftCollection: names.left, rightCollection: names.right },
    });
    assert.equal(m2m.response.status, 201);

    const [events] = await pool.query(
      `SELECT event_name, item_key, collection_name, broad_event FROM ${quotedEvents} ORDER BY seq`,
    );
    assert.deepEqual(events[0], {
      event_name: 'extension.env',
      item_key: `extension-process-${runId}`,
      collection_name: null,
      broad_event: null,
    });
    const schemaEvents = events.slice(1);
    assert.equal(schemaEvents.length, 16);
    for (let index = 0; index < schemaEvents.length; index += 2) {
      const specific = schemaEvents[index];
      const broad = schemaEvents[index + 1];
      assert.notEqual(specific.event_name, 'schema.changed');
      assert.equal(specific.broad_event, null);
      assert.equal(broad.event_name, 'schema.changed');
      assert.equal(broad.broad_event, specific.event_name);
      assert.equal(broad.item_key, specific.item_key);
      assert.equal(broad.collection_name, specific.collection_name);
    }
    assert.deepEqual(schemaEvents.filter((entry) => entry.event_name === 'schema.relation.create').map((entry) => entry.item_key), [
      'many_id',
      'one_id',
      names.junction,
    ]);

    await pool.query(
      `ALTER TABLE yuncms_fields
       ADD CONSTRAINT ${quotedFailureConstraint}
       CHECK (NOT (collection = ? AND field = ?))`,
      [names.left, 'compensated'],
    );
    failureConstraintCreated = true;

    const failed = await jsonRequest(port, token, `/schema/collections/${names.left}/fields`, {
      method: 'POST', body: { field: 'compensated', type: 'string', required: false },
    });
    assert.equal(failed.response.status, 500);
    const [failedEvents] = await pool.query(
      `SELECT event_name FROM ${quotedEvents} WHERE item_key = ?`,
      ['compensated'],
    );
    assert.deepEqual(failedEvents, []);
    const [physicalColumns] = await pool.query(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [names.left, 'compensated'],
    );
    assert.deepEqual(physicalColumns, []);
    const [metadataFields] = await pool.query(
      'SELECT field FROM yuncms_fields WHERE collection = ? AND field = ?',
      [names.left, 'compensated'],
    );
    assert.deepEqual(metadataFields, []);

    await pool.query(`ALTER TABLE yuncms_fields DROP CHECK ${quotedFailureConstraint}`);
    failureConstraintCreated = false;

    assert.equal((await jsonRequest(port, token, `/schema/relations/m2m/${names.junction}?destructive=true`, { method: 'DELETE' })).response.status, 204);
    assert.equal((await jsonRequest(port, token, `/schema/relations/o2o/${names.one}/one_id`, { method: 'DELETE' })).response.status, 204);
    assert.equal((await jsonRequest(port, token, `/schema/relations/m2o/${names.left}/many_id`, { method: 'DELETE' })).response.status, 204);
    for (const collection of [names.left, names.right, names.one]) {
      const deleted = await jsonRequest(port, token, `/schema/collections/${collection}?destructive=true`, { method: 'DELETE' });
      assert.equal(deleted.response.status, 204);
    }
  } finally {
    let cleanupError = null;
    try { await stopApi(processInfo); } catch (error) { cleanupError ??= error; }
    if (failureConstraintCreated) {
      await pool.query(`ALTER TABLE yuncms_fields DROP CHECK ${quotedFailureConstraint}`).catch(() => {});
    }
    for (const collection of [names.junction, names.left, names.right, names.one]) {
      const quoted = quoteIdentifier(collection, 'integration collection');
      await pool.query(`DROP TABLE IF EXISTS ${quoted}`).catch(() => {});
      await pool.query('DELETE FROM yuncms_permissions WHERE collection = ?', [collection]).catch(() => {});
      await pool.query('DELETE FROM yuncms_relations WHERE many_collection = ? OR one_collection = ? OR junction_collection = ?', [collection, collection, collection]).catch(() => {});
      await pool.query('DELETE FROM yuncms_fields WHERE collection = ?', [collection]).catch(() => {});
      await pool.query('DELETE FROM yuncms_collections WHERE collection = ?', [collection]).catch(() => {});
    }
    if (admin) {
      await pool.query('DELETE FROM yuncms_users WHERE id = ?', [admin.user.id]).catch(() => {});
      await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [admin.role.id]).catch(() => {});
    }
    await pool.query(`DROP TABLE IF EXISTS ${quotedEvents}`).catch(() => {});
    await closeDatabasePool(pool).catch(() => {});
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
    if (cleanupError) throw cleanupError;
  }
});

test('two API processes run one singleton job and bound SIGTERM with a long job', {
  skip: !ENABLED,
  timeout: 120_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);
  const runId = suffix();
  const runsTable = safeName('it_schedule_runs', runId);
  const quotedRuns = quoteIdentifier(runsTable, 'integration scheduler table');
  const storageRoot = await mkdtemp(join(tmpdir(), 'yuncms-scheduler-storage-'));
  let projectRoot;
  const processes = [];

  try {
    await bootstrapDatabase(pool);
    await pool.query(
      `CREATE TABLE ${quotedRuns} (
        seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        event_name VARCHAR(20) NOT NULL,
        process_id BIGINT NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB`,
    );
    const source = `
export default {
  __yuncms_extension__: true,
  type: 'hook',
  register({ init, schedule }) {
    init('app.beforeStop', async ({ database }) => {
      await database.query('INSERT INTO ${runsTable} (event_name, process_id) VALUES (?, ?)', ['stopped', process.pid]);
    });
    schedule('* * * * *', async ({ database }) => {
      await database.query('INSERT INTO ${runsTable} (event_name, process_id) VALUES (?, ?)', ['started', process.pid]);
      await new Promise((resolve) => setTimeout(resolve, 7000));
      await database.query('INSERT INTO ${runsTable} (event_name, process_id) VALUES (?, ?)', ['finished', process.pid]);
    }, { id: 'release-gate', mode: 'singleton', overlap: 'skip', accountability: 'system' });
  },
};
`;
    projectRoot = await createExtensionProject(`scheduler-${runId}`, source);
    const [portA, portB] = await Promise.all([availablePort(), availablePort()]);
    const env = serverEnv(config, storageRoot);
    const processA = startApi(projectRoot, portA, { ...env, STUDIO_ORIGIN: `http://127.0.0.1:${portA}` });
    const processB = startApi(projectRoot, portB, { ...env, STUDIO_ORIGIN: `http://127.0.0.1:${portB}` });
    processes.push(processA, processB);
    await Promise.all([waitForReady(processA), waitForReady(processB)]);

    const deadline = Date.now() + 10_000;
    let started = [];
    while (Date.now() < deadline) {
      [started] = await pool.query(`SELECT process_id FROM ${quotedRuns} WHERE event_name = ?`, ['started']);
      if (started.length === 1) break;
      await wait(100);
    }
    assert.equal(started.length, 1);
    await wait(500);
    const [stableStarted] = await pool.query(`SELECT process_id FROM ${quotedRuns} WHERE event_name = ?`, ['started']);
    assert.equal(stableStarted.length, 1);

    const shutdownStarted = Date.now();
    for (const processInfo of processes) processInfo.child.kill('SIGTERM');
    const exits = await Promise.all(processes.map(async (processInfo) => {
      const result = await Promise.race([
        processInfo.exited,
        wait(11_000, { unref: true }).then(() => null),
      ]);
      if (!result) {
        processInfo.child.kill('SIGKILL');
        await processInfo.exited;
        throw new Error(`API process exceeded SIGTERM budget:\n${processInfo.output.join('')}`);
      }
      return result;
    }));
    const shutdownElapsed = Date.now() - shutdownStarted;
    assert.deepEqual(exits.map((entry) => entry.code), [0, 0]);
    assert.ok(shutdownElapsed >= 4_500, `long-job shutdown returned too early: ${shutdownElapsed}ms`);
    assert.ok(shutdownElapsed < 10_000, `long-job shutdown exceeded server budget: ${shutdownElapsed}ms`);

    const [events] = await pool.query(`SELECT event_name, process_id FROM ${quotedRuns} ORDER BY seq`);
    assert.equal(events.filter((entry) => entry.event_name === 'started').length, 1);
    assert.equal(events.filter((entry) => entry.event_name === 'finished').length, 0);
    assert.equal(events.filter((entry) => entry.event_name === 'stopped').length, 2);
  } finally {
    for (const processInfo of processes) {
      if (processInfo.child.exitCode == null) processInfo.child.kill('SIGKILL');
    }
    await pool.query(`DROP TABLE IF EXISTS ${quotedRuns}`).catch(() => {});
    await closeDatabasePool(pool).catch(() => {});
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
  }
});
