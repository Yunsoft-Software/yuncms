import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountability, createSystemAccountability } from '../src/accountability.js';
import { RolesService } from '../src/services/roles-service.js';
import { UsersService } from '../src/services/users-service.js';
import {
  buildSystemListQuery,
  parseSystemListQuery,
  ROLE_SAFE_SELECT_COLUMNS,
  ROLE_SYSTEM_SEARCH_SCHEMA,
  SYSTEM_LIST_LIMITS,
  USER_SAFE_SELECT_COLUMNS,
  USER_SYSTEM_SEARCH_SCHEMA,
} from '../src/system-list-query.js';

const mockSchema = {
  version: 7,
  collections: {
    yuncms_users: {
      collection: 'yuncms_users',
      system: true,
      metadata: {
        permissionManaged: true,
        permissionMode: 'action-only',
        resource: 'users',
        allowedActions: ['read', 'create', 'update', 'delete'],
      },
      fields: {
        id: { field: 'id', type: 'uuid' },
        email: { field: 'email', type: 'string' },
      },
    },
    yuncms_roles: {
      collection: 'yuncms_roles',
      system: true,
      metadata: {
        permissionManaged: true,
        permissionMode: 'action-only',
        resource: 'roles',
        allowedActions: ['read', 'create', 'update', 'delete'],
      },
      fields: {
        id: { field: 'id', type: 'uuid' },
        name: { field: 'name', type: 'string' },
        description: { field: 'description', type: 'string' },
      },
    },
  },
};

function createMockDatabase({ rows = [], permissions = [] } = {}) {
  const executed = [];
  return {
    executed,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      executed.push({ sql: normalized, rawSql: sql, params });

      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        const [role, collection, action] = params;
        const matching = permissions.filter(
          (p) => p.role === role && p.collection === collection && p.action === action,
        );
        return [matching, []];
      }

      return [rows, []];
    },
  };
}

test('parseSystemListQuery preserves empty query unbounded mode for Studio compatibility', () => {
  for (const empty of [undefined, null, {}, Object.create(null)]) {
    const result = parseSystemListQuery(empty);
    assert.equal(result.isBounded, false);
    assert.equal(result.limit, null);
    assert.equal(result.offset, null);
    assert.equal(result.search, null);
  }
});

test('parseSystemListQuery activates bounded mode with defaults upon any parameter', () => {
  const byLimit = parseSystemListQuery({ limit: 50 });
  assert.equal(byLimit.isBounded, true);
  assert.equal(byLimit.limit, 50);
  assert.equal(byLimit.offset, 0);
  assert.equal(byLimit.search, null);

  const byOffset = parseSystemListQuery({ offset: 25 });
  assert.equal(byOffset.isBounded, true);
  assert.equal(byOffset.limit, 100);
  assert.equal(byOffset.offset, 25);
  assert.equal(byOffset.search, null);

  const bySearch = parseSystemListQuery({ search: 'alice' });
  assert.equal(bySearch.isBounded, true);
  assert.equal(bySearch.limit, 100);
  assert.equal(bySearch.offset, 0);
  assert.equal(bySearch.search, 'alice');

  const emptySearch = parseSystemListQuery({ search: '   ' });
  assert.equal(emptySearch.isBounded, true);
  assert.equal(emptySearch.limit, 100);
  assert.equal(emptySearch.offset, 0);
  assert.equal(emptySearch.search, null);
});

test('parseSystemListQuery parses string integers and enforces boundary limits', () => {
  const parsed = parseSystemListQuery({ limit: '500', offset: '1000000', search: '  test  ' });
  assert.equal(parsed.limit, 500);
  assert.equal(parsed.offset, 1_000_000);
  assert.equal(parsed.search, 'test');

  const minParsed = parseSystemListQuery({ limit: '1', offset: '0' });
  assert.equal(minParsed.limit, 1);
  assert.equal(minParsed.offset, 0);

  const maxLengthSearch = 'a'.repeat(SYSTEM_LIST_LIMITS.maxSearchLength);
  const searchParsed = parseSystemListQuery({ search: maxLengthSearch });
  assert.equal(searchParsed.search, maxLengthSearch);
});

test('parseSystemListQuery rejects invalid inputs, unknown keys, booleans, objects, arrays, and out-of-range values', () => {
  const invalidQueries = [
    'not an object',
    123,
    true,
    false,
    ['limit', '10'],
  ];
  for (const invalid of invalidQueries) {
    assert.throws(
      () => parseSystemListQuery(invalid),
      (err) => err.code === 'INVALID_QUERY',
      `Expected ${JSON.stringify(invalid)} to be rejected`,
    );
  }

  const unknownKeys = [
    { fields: 'id,email' },
    { filter: { email: 'alice' } },
    { sort: 'email' },
    { groupBy: 'role' },
    { aggregate: { count: '*' } },
    { page: 1 },
    { pageSize: 20 },
    { unknownKey: true },
  ];
  for (const query of unknownKeys) {
    assert.throws(
      () => parseSystemListQuery(query),
      (err) => err.code === 'INVALID_QUERY' && err.message.includes('Unknown query parameter'),
      `Expected unknown key ${JSON.stringify(query)} to be rejected`,
    );
  }

  const invalidLimits = [
    { limit: 0 },
    { limit: -1 },
    { limit: 501 },
    { limit: 1.5 },
    { limit: 'abc' },
    { limit: true },
    { limit: false },
    { limit: [10] },
    { limit: { value: 10 } },
  ];
  for (const query of invalidLimits) {
    assert.throws(
      () => parseSystemListQuery(query),
      (err) => err.code === 'INVALID_QUERY' && err.path === 'limit',
      `Expected limit ${JSON.stringify(query.limit)} to be rejected`,
    );
  }

  const invalidOffsets = [
    { offset: -1 },
    { offset: 1_000_001 },
    { offset: 2.5 },
    { offset: 'xyz' },
    { offset: true },
    { offset: false },
    { offset: [0] },
    { offset: { offset: 0 } },
  ];
  for (const query of invalidOffsets) {
    assert.throws(
      () => parseSystemListQuery(query),
      (err) => err.code === 'INVALID_QUERY' && err.path === 'offset',
      `Expected offset ${JSON.stringify(query.offset)} to be rejected`,
    );
  }

  const invalidSearches = [
    { search: true },
    { search: false },
    { search: ['needle'] },
    { search: { needle: 'test' } },
    { search: 'x'.repeat(201) },
  ];
  for (const query of invalidSearches) {
    assert.throws(
      () => parseSystemListQuery(query),
      (err) => err.code === 'INVALID_QUERY' && err.path === 'search',
      `Expected search ${JSON.stringify(query.search)} to be rejected`,
    );
  }
});

test('buildSystemListQuery compiles unbounded query with stable order and no placeholders', () => {
  const userResult = buildSystemListQuery({}, {
    table: 'yuncms_users',
    columns: USER_SAFE_SELECT_COLUMNS,
    orderBy: 'email ASC, id ASC',
    searchSchema: USER_SYSTEM_SEARCH_SCHEMA,
  });
  assert.equal(userResult.parsed.isBounded, false);
  assert.deepEqual(userResult.params, []);
  assert.match(userResult.sql, /SELECT id, email, role, status, email_verified_at, last_access, created_at, updated_at/);
  assert.match(userResult.sql, /FROM yuncms_users/);
  assert.match(userResult.sql, /ORDER BY email ASC, id ASC$/);
  assert.doesNotMatch(userResult.sql, /LIMIT/);
  assert.doesNotMatch(userResult.sql, /WHERE/);

  const roleResult = buildSystemListQuery(undefined, {
    table: 'yuncms_roles',
    columns: ROLE_SAFE_SELECT_COLUMNS,
    orderBy: 'name ASC, id ASC',
    searchSchema: ROLE_SYSTEM_SEARCH_SCHEMA,
  });
  assert.equal(roleResult.parsed.isBounded, false);
  assert.deepEqual(roleResult.params, []);
  assert.match(roleResult.sql, /SELECT id, name, description, admin, public, created_at, updated_at/);
  assert.match(roleResult.sql, /FROM yuncms_roles/);
  assert.match(roleResult.sql, /ORDER BY name ASC, id ASC$/);
  assert.doesNotMatch(roleResult.sql, /LIMIT/);
  assert.doesNotMatch(roleResult.sql, /WHERE/);
});

test('buildSystemListQuery binds limit, offset and search with placeholder parameters', () => {
  const boundedUsers = buildSystemListQuery({ limit: 20, offset: 40 }, {
    table: 'yuncms_users',
    columns: USER_SAFE_SELECT_COLUMNS,
    orderBy: 'email ASC, id ASC',
    searchSchema: USER_SYSTEM_SEARCH_SCHEMA,
  });
  assert.equal(boundedUsers.parsed.isBounded, true);
  assert.deepEqual(boundedUsers.params, [20, 40]);
  assert.match(boundedUsers.sql, /LIMIT \? OFFSET \?/);
  assert.doesNotMatch(boundedUsers.sql, /WHERE/);

  const userSearch = buildSystemListQuery({ search: 'acme' }, {
    table: 'yuncms_users',
    columns: USER_SAFE_SELECT_COLUMNS,
    orderBy: 'email ASC, id ASC',
    searchSchema: USER_SYSTEM_SEARCH_SCHEMA,
  });
  assert.equal(userSearch.parsed.isBounded, true);
  assert.match(userSearch.sql, /WHERE \(`email` LIKE \? ESCAPE '\\\\'\)/);
  assert.match(userSearch.sql, /ORDER BY email ASC, id ASC/);
  assert.match(userSearch.sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(userSearch.params, ['%acme%', 100, 0]);

  const roleSearch = buildSystemListQuery({ search: 'editor', limit: 10, offset: 5 }, {
    table: 'yuncms_roles',
    columns: ROLE_SAFE_SELECT_COLUMNS,
    orderBy: 'name ASC, id ASC',
    searchSchema: ROLE_SYSTEM_SEARCH_SCHEMA,
  });
  assert.equal(roleSearch.parsed.isBounded, true);
  assert.match(roleSearch.sql, /WHERE \(`name` LIKE \? ESCAPE '\\\\' OR `description` LIKE \? ESCAPE '\\\\'\)/);
  assert.match(roleSearch.sql, /ORDER BY name ASC, id ASC/);
  assert.match(roleSearch.sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(roleSearch.params, ['%editor%', '%editor%', 10, 5]);
});

test('search needle correctly escapes literal percent, underscore and backslash', () => {
  const needle = '100%_safe\\domain';
  const userResult = buildSystemListQuery({ search: needle }, {
    table: 'yuncms_users',
    columns: USER_SAFE_SELECT_COLUMNS,
    orderBy: 'email ASC, id ASC',
    searchSchema: USER_SYSTEM_SEARCH_SCHEMA,
  });
  assert.equal(userResult.params[0], '%100\\%\\_safe\\\\domain%');
  assert.equal(userResult.params[1], 100);
  assert.equal(userResult.params[2], 0);

  const roleResult = buildSystemListQuery({ search: needle }, {
    table: 'yuncms_roles',
    columns: ROLE_SAFE_SELECT_COLUMNS,
    orderBy: 'name ASC, id ASC',
    searchSchema: ROLE_SYSTEM_SEARCH_SCHEMA,
  });
  assert.equal(roleResult.params[0], '%100\\%\\_safe\\\\domain%');
  assert.equal(roleResult.params[1], '%100\\%\\_safe\\\\domain%');
  assert.equal(roleResult.params[2], 100);
  assert.equal(roleResult.params[3], 0);
});

test('UsersService.readMany executes unbounded and bounded queries with safe columns', async () => {
  const db = createMockDatabase({
    rows: [{
      id: 'u-1',
      email: 'admin@yuncms.test',
      role: null,
      status: 'active',
      email_verified_at: null,
      last_access: null,
      created_at: null,
      updated_at: null,
    }],
  });
  const service = new UsersService({
    database: db,
    schema: mockSchema,
    accountability: createSystemAccountability(),
  });

  const emptyResult = await service.readMany();
  assert.equal(emptyResult.length, 1);
  assert.equal(db.executed.length, 1);
  assert.equal(db.executed[0].sql, 'SELECT id, email, role, status, email_verified_at, last_access, created_at, updated_at FROM yuncms_users ORDER BY email ASC, id ASC');
  assert.deepEqual(db.executed[0].params, []);

  assert.doesNotMatch(db.executed[0].sql, /password_hash/);
  assert.doesNotMatch(db.executed[0].sql, /token/);
  assert.doesNotMatch(db.executed[0].sql, /secret/);

  const boundedResult = await service.readMany({ limit: 10, offset: 5, search: 'admin' });
  assert.equal(boundedResult.length, 1);
  assert.equal(db.executed.length, 2);
  assert.match(db.executed[1].sql, /WHERE \(`email` LIKE \? ESCAPE '\\\\'\)/);
  assert.match(db.executed[1].sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(db.executed[1].params, ['%admin%', 10, 5]);
});

test('RolesService.readMany executes unbounded and bounded queries across name and description', async () => {
  const db = createMockDatabase({
    rows: [{
      id: 'r-1',
      name: 'Manager',
      description: 'Department manager',
      admin: 0,
      public: 0,
      created_at: null,
      updated_at: null,
    }],
  });
  const service = new RolesService({
    database: db,
    schema: mockSchema,
    accountability: createSystemAccountability(),
  });

  const emptyResult = await service.readMany({});
  assert.equal(emptyResult.length, 1);
  assert.equal(db.executed.length, 1);
  assert.equal(db.executed[0].sql, 'SELECT id, name, description, admin, public, created_at, updated_at FROM yuncms_roles ORDER BY name ASC, id ASC');
  assert.deepEqual(db.executed[0].params, []);

  const boundedResult = await service.readMany({ search: 'Manager', limit: 25 });
  assert.equal(boundedResult.length, 1);
  assert.equal(db.executed.length, 2);
  assert.match(db.executed[1].sql, /WHERE \(`name` LIKE \? ESCAPE '\\\\' OR `description` LIKE \? ESCAPE '\\\\'\)/);
  assert.match(db.executed[1].sql, /ORDER BY name ASC, id ASC/);
  assert.deepEqual(db.executed[1].params, ['%Manager%', '%Manager%', 25, 0]);
});

test('explicit delegated read grant succeeds while denied role is rejected with FORBIDDEN', async () => {
  const grantedDb = createMockDatabase({
    rows: [{ id: 'u-1', email: 'test@example.com' }],
    permissions: [{
      id: 'perm-users-read',
      role: 'delegated-role',
      collection: 'yuncms_users',
      action: 'read',
    }, {
      id: 'perm-roles-read',
      role: 'delegated-role',
      collection: 'yuncms_roles',
      action: 'read',
    }],
  });

  const grantedUsers = new UsersService({
    database: grantedDb,
    schema: mockSchema,
    accountability: createAccountability({ user: 'm-1', role: 'delegated-role' }),
  });
  const grantedRoles = new RolesService({
    database: grantedDb,
    schema: mockSchema,
    accountability: createAccountability({ user: 'm-1', role: 'delegated-role' }),
  });

  const users = await grantedUsers.readMany({ limit: 10 });
  assert.equal(users.length, 1);
  const roles = await grantedRoles.readMany({ limit: 10 });
  assert.equal(roles.length, 1);

  const deniedDb = createMockDatabase({ rows: [], permissions: [] });
  const deniedUsers = new UsersService({
    database: deniedDb,
    schema: mockSchema,
    accountability: createAccountability({ user: 'm-2', role: 'unauthorized-role' }),
  });
  const deniedRoles = new RolesService({
    database: deniedDb,
    schema: mockSchema,
    accountability: createAccountability({ user: 'm-2', role: 'unauthorized-role' }),
  });

  await assert.rejects(
    () => deniedUsers.readMany({ limit: 10 }),
    (err) => err.code === 'FORBIDDEN',
  );
  await assert.rejects(
    () => deniedRoles.readMany({ limit: 10 }),
    (err) => err.code === 'FORBIDDEN',
  );
});
