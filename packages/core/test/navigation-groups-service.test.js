import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NavigationGroupsService,
  normalizeNavigationGroupCollapse,
} from '../src/services/navigation-groups-service.js';

const editor = { user: 'user-1', role: 'role-1', admin: false, system: false };
const admin = { user: 'admin-1', role: 'admin-role', admin: true, system: false };

function database(rows = []) {
  return {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql, params });
      if (/SELECT id, name, sort, collapse/.test(sql)) return [rows];
      if (/INSERT INTO yuncms_navigation_groups/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('authenticated non-admin services may read navigation groups for Content rendering', async () => {
  const db = database([{ id: 'g1', name: 'Site', sort: 10, collapse: 'closed' }]);
  const service = new NavigationGroupsService({ accountability: editor, database: db });
  assert.deepEqual(await service.readMany(), [{ id: 'g1', name: 'Site', sort: 10, collapse: 'closed' }]);
});

test('non-admin services cannot create navigation groups', async () => {
  const service = new NavigationGroupsService({ accountability: editor, database: database() });
  await assert.rejects(
    () => service.createOne({ name: 'Secret' }),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('schema administrators can create navigation-only groups with a Directus-like collapse state', async () => {
  const db = database([{ id: 'generated', name: 'Site', sort: 20, collapse: 'locked' }]);
  const service = new NavigationGroupsService({ accountability: admin, database: db });
  const created = await service.createOne({ name: ' Site ', sort: 20, collapse: 'locked' });
  assert.equal(created.name, 'Site');
  const insert = db.queries.find((entry) => /INSERT INTO yuncms_navigation_groups/.test(entry.sql));
  assert.equal(insert.params[1], 'Site');
  assert.equal(insert.params[2], 20);
  assert.equal(insert.params[3], 'locked');
});

test('navigation group collapse values stay within open, closed and locked', () => {
  assert.equal(normalizeNavigationGroupCollapse(undefined), 'open');
  assert.equal(normalizeNavigationGroupCollapse(' CLOSED '), 'closed');
  assert.equal(normalizeNavigationGroupCollapse('locked'), 'locked');
  assert.throws(
    () => normalizeNavigationGroupCollapse('sometimes'),
    (error) => error.code === 'INVALID_PAYLOAD',
  );
});

test('deleting a folder uses a pooled transaction and moves member collections to the root', async () => {
  const state = { began: false, committed: false, rolledBack: false, released: false };
  const connection = {
    async beginTransaction() { state.began = true; },
    async commit() { state.committed = true; },
    async rollback() { state.rolledBack = true; },
    release() { state.released = true; },
    async query(sql, params = []) {
      if (/SELECT id FROM yuncms_navigation_groups/.test(sql)) return [[{ id: 'site' }]];
      if (/UPDATE yuncms_collections/.test(sql)) {
        assert.deepEqual(params, ['site']);
        return [{ affectedRows: 2 }];
      }
      if (/DELETE FROM yuncms_navigation_groups/.test(sql)) return [{ affectedRows: 1 }];
      if (/UPDATE yuncms_schema_state/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT version FROM yuncms_schema_state/.test(sql)) return [[{ version: 12 }]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const pool = { async getConnection() { return connection; } };
  const service = new NavigationGroupsService({ accountability: admin, database: pool });

  assert.deepEqual(await service.deleteOne('site'), { deleted: true, id: 'site' });
  assert.deepEqual(state, { began: true, committed: true, rolledBack: false, released: true });
});
