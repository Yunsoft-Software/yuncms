import assert from 'node:assert/strict';
import test from 'node:test';

import { NavigationGroupsService } from '../src/services/navigation-groups-service.js';

const editor = { user: 'user-1', role: 'role-1', admin: false, system: false };
const admin = { user: 'admin-1', role: 'admin-role', admin: true, system: false };

function database(rows = []) {
  return {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql, params });
      if (/SELECT id, name, sort/.test(sql)) return [rows];
      if (/INSERT INTO yuncms_navigation_groups/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('authenticated non-admin services may read navigation groups for Content rendering', async () => {
  const db = database([{ id: 'g1', name: 'Site', sort: 10 }]);
  const service = new NavigationGroupsService({ accountability: editor, database: db });
  assert.deepEqual(await service.readMany(), [{ id: 'g1', name: 'Site', sort: 10 }]);
});

test('non-admin services cannot create navigation groups', async () => {
  const service = new NavigationGroupsService({ accountability: editor, database: database() });
  await assert.rejects(
    () => service.createOne({ name: 'Secret' }),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('schema administrators can create navigation-only groups', async () => {
  const db = database([{ id: 'generated', name: 'Site', sort: 20 }]);
  const service = new NavigationGroupsService({ accountability: admin, database: db });
  const created = await service.createOne({ name: ' Site ', sort: 20 });
  assert.equal(created.name, 'Site');
  const insert = db.queries.find((entry) => /INSERT INTO yuncms_navigation_groups/.test(entry.sql));
  assert.equal(insert.params[1], 'Site');
  assert.equal(insert.params[2], 20);
});
