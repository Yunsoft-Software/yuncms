import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapDatabase, createDatabasePool, createSystemAccountability,
  loadConfig, RolesService, UsersService } from '@yunsoft/yuncms-core';

export const ownFilesFilter = { uploaded_by: { _eq: '$CURRENT_USER' } };

// Real, isolated storage/MySQL/auth; shared by HTTP and Chromium regressions.
export async function createFileCacheFixture() {
  assert.equal(process.env.YUNCMS_TEST_MYSQL, '1');
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  const config = loadConfig(process.env);
  assert.match(config.database.database, /(test|ci|dev)/i);
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(config.database.host));
  const dbName = 'yuncms_test_file_cache_' + randomBytes(6).toString('hex');
  const root = createDatabasePool({ ...config.database, database: undefined });
  let database, directory, server, port, databaseCreated = false;
  try {
    await root.query('CREATE DATABASE `' + dbName + '`');
    databaseCreated = true;
    database = createDatabasePool({ ...config.database, database: dbName });
    directory = await mkdtemp(join(tmpdir(), 'yuncms-file-cache-'));
    await bootstrapDatabase(database);
    const options = { database, accountability: createSystemAccountability() };
    const roles = new RolesService(options), users = new UsersService(options);
    const password = 'File-cache-disposable-' + randomBytes(16).toString('hex') + '!';
    const actors = {};
    for (const name of ['owner', 'reader', 'other']) {
      const role = await roles.createOne({ name: 'File cache ' + name, admin: name === 'owner' });
      const user = await users.createOne({ email: name + '@file-cache.example.test', password, role: role.id });
      actors[name] = { ...user, role: role.id };
    }
    const stop = async () => {
      if (!server) return;
      const child = server; server = null;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('File cache runtime failed to stop')); }, 10000);
        child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('File cache runtime exit: ' + code)); });
        child.kill('SIGTERM');
      });
    };
    const start = async () => {
      server = fork(new URL('./file-cache-server.mjs', import.meta.url), [], {
        env: { ...process.env, DB_DATABASE: dbName, FILE_CACHE_FIXTURE_ROOT: directory,
          FILE_CACHE_FIXTURE_PORT: String(port ?? 0) },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { server.kill('SIGTERM'); reject(new Error('File cache runtime failed to start')); }, 15000);
        server.once('error', error => { clearTimeout(timer); reject(error); });
        server.once('exit', code => { clearTimeout(timer); reject(new Error('File cache runtime exited before readiness: ' + code)); });
        server.once('message', message => { clearTimeout(timer); port = message.port; resolve(); });
      });
    };
    await start();
    const origin = 'http://127.0.0.1:' + port;
    const request = async (path, { token, method = 'GET', body, bytes, headers = {} } = {}) => {
      const response = await fetch(origin + path, { method, headers: {
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: bytes ?? (body === undefined ? undefined : JSON.stringify(body)) });
      const contents = Buffer.from(await response.arrayBuffer());
      return { status: response.status, headers: response.headers, bytes: contents,
        body: response.headers.get('content-type')?.includes('application/json') && contents.length ? JSON.parse(contents) : null };
    };
    const login = async name => {
      const result = await request('/auth/login', { method: 'POST', body: { email: actors[name].email, password } });
      assert.equal(result.status, 200); return result.body.data.access_token;
    };
    const tokens = {};
    for (const name of Object.keys(actors)) tokens[name] = await login(name);
    const permission = async (role, filter) => {
      const r = await request('/permissions', { token: tokens.owner, method: 'POST',
        body: { role, collection: 'yuncms_files', action: 'read', filter } });
      assert.equal(r.status, 201); return r.body.data;
    };
    const readerPermission = await permission(actors.reader.role, ownFilesFilter);
    await permission(actors.other.role, ownFilesFilter);
    const bytes = Buffer.from(('Private cache regression ' + dbName + '\n').repeat(64));
    const neighborBytes = Buffer.from('Independent file must remain intact: ' + dbName);
    const upload = async (title, contents) => {
      const r = await request('/files', { token: tokens.owner, method: 'POST', bytes: contents,
        headers: { 'content-type': 'application/octet-stream', 'x-filename': title + '.txt', 'x-title': title, 'x-mimetype': 'text/plain' } });
      assert.equal(r.status, 201);
      // A real persisted, old file gives HTTP heuristic freshness a meaningful
      // lifetime. No fake browser/network, storage driver or scheduler clock.
      await utimes(join(directory, r.body.data.filename_disk), new Date('2001-01-01'), new Date('2001-01-01'));
      return r.body.data;
    };
    const file = await upload('private-cache', bytes), neighbor = await upload('neighbor-cache', neighborBytes);
    const readerFilter = enabled => enabled ? { _or: [ownFilesFilter, { id: { _eq: file.id } }] } : ownFilesFilter;
    const assertPersistedReaderFilter = async filter => {
      const [[row]] = await database.query('SELECT filter FROM yuncms_permissions WHERE id = ?', [readerPermission.id]);
      const actual = typeof row.filter === 'string' ? JSON.parse(row.filter) : row.filter;
      assert.deepEqual(actual, filter);
    };
    const setReaderGrant = async enabled => {
      const filter = readerFilter(enabled);
      const r = await request('/permissions/' + readerPermission.id, { token: tokens.owner, method: 'PATCH', body: { filter } });
      assert.equal(r.status, 200);
      await assertPersistedReaderFilter(filter);
    };
    const withPendingReaderGrant = async (enabled, { commit }, readWhileHeld) => {
      const filter = readerFilter(enabled);
      const send = async (message, phase) => {
        const response = once(server, 'message', { signal: AbortSignal.timeout(15000) });
        server.send(message);
        const [result] = await response;
        assert.equal(result.phase, phase, result.message);
        return result;
      };
      await send({
        type: 'hold-permission-write', permissionId: readerPermission.id, filter,
        reader: { user: actors.reader.id, role: actors.reader.role },
      }, 'permission-write-held');
      try {
        await readWhileHeld();
      } finally {
        const finished = await send({ type: 'finish-permission-write', commit }, 'permission-write-finished');
        assert.equal(finished.committed, commit);
        assert.deepEqual(finished.filter, filter, 'The transaction sees its own permission change');
      }
      if (commit) await assertPersistedReaderFilter(filter);
    };
    const publicGrant = async () => {
      const [[role]] = await database.query('SELECT id FROM yuncms_roles WHERE public = 1');
      return permission(role.id, { id: { _eq: neighbor.id } });
    };
    return { origin, studioOrigin: config.server.studioOrigin, database, actors, tokens, file, neighbor, bytes, neighborBytes, request, login, setReaderGrant, withPendingReaderGrant, publicGrant,
      async restart() { const previousPid = server.pid; await stop(); await start(); return { previousPid, currentPid: server.pid }; },
      async close() {
        try { await stop(); await database.end(); await root.query('DROP DATABASE `' + dbName + '`'); }
        finally { await root.end(); await rm(directory, { recursive: true, force: true }); }
      } };
  } catch (error) {
    if (server && server.exitCode === null && server.signalCode === null) {
      const child = server; await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
    }
    await database?.end();
    try { if (databaseCreated) await root.query('DROP DATABASE IF EXISTS `' + dbName + '`'); } finally { await root.end(); }
    if (directory) await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
