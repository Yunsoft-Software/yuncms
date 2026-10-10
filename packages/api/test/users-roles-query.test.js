import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCoreServiceRegistry,
  createPublicAccountability,
  createServiceRegistry,
} from '@yunsoft/yuncms-core';
import { createApp } from '../src/app.js';

class MockAuthService {
  async resolvePublicAccountability() {
    return createPublicAccountability({ role: 'public-role' });
  }

  async authenticateBearerToken(token) {
    if (token === 'admin-token') {
      return { user: 'admin-1', role: 'admin-role', admin: true, authMethod: 'api_token' };
    }
    if (token === 'delegated-granted-token') {
      return { user: 'manager-1', role: 'delegated-role', admin: false, authMethod: 'api_token' };
    }
    if (token === 'delegated-denied-token') {
      return { user: 'user-2', role: 'denied-role', admin: false, authMethod: 'api_token' };
    }
    const error = new Error('Invalid token');
    error.code = 'UNAUTHORIZED';
    throw error;
  }
}

function createMockPool({ userRows = [], roleRows = [], grantedRoles = ['delegated-role'] } = {}) {
  const executed = [];
  return {
    executed,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      executed.push({ sql: normalized, rawSql: sql, params });

      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        const [role, collection, action] = params;
        if (grantedRoles.includes(role) && action === 'read') {
          return [[{
            id: `perm-${role}-${action}`,
            role,
            collection,
            action,
            fields: null,
            filter: null,
            validation: null,
          }], []];
        }
        return [[], []];
      }

      if (normalized.startsWith('SELECT id, email, role, status')) {
        return [userRows, []];
      }

      if (normalized.startsWith('SELECT id, name, description, admin, public')) {
        return [roleRows, []];
      }

      return [[], []];
    },
  };
}

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

async function withServer(operation, options = {}) {
  const pool = createMockPool(options);
  const schemaCache = {
    async get() { return mockSchema; },
    clear() {},
  };
  const coreServices = createCoreServiceRegistry().toObject();
  const registry = createServiceRegistry({
    ...coreServices,
    AuthService: MockAuthService,
  });

  const app = createApp({
    pool,
    config: {
      server: { studioOrigin: 'http://localhost:3008', trustProxyHops: 0 },
      storage: { maxUploadBytes: 1024 },
      auth: { rateLimit: {} },
    },
    schemaCache,
    serviceRegistry: registry,
    logger: { info() {}, warn() {}, error() {} },
  });

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });

  try {
    const { port } = server.address();
    await operation(`http://127.0.0.1:${port}`, pool);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /users and GET /roles forward unbounded empty query for Studio compatibility', async () => {
  const sampleUsers = [{ id: 'u-1', email: 'alice@example.test', role: null, status: 'active' }];
  const sampleRoles = [{ id: 'r-1', name: 'Editor', description: 'Editorial staff', admin: 0, public: 0 }];

  await withServer(async (origin, pool) => {
    const userRes = await fetch(`${origin}/users`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(userRes.status, 200);
    const userData = await userRes.json();
    assert.deepEqual(userData.data, sampleUsers);

    const lastUserQuery = pool.executed.find((e) => e.sql.includes('FROM yuncms_users'));
    assert.ok(lastUserQuery);
    assert.equal(lastUserQuery.sql, 'SELECT id, email, role, status, email_verified_at, last_access, created_at, updated_at FROM yuncms_users ORDER BY email ASC, id ASC');
    assert.deepEqual(lastUserQuery.params, []);

    const roleRes = await fetch(`${origin}/roles`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(roleRes.status, 200);
    const roleData = await roleRes.json();
    assert.deepEqual(roleData.data, sampleRoles);

    const lastRoleQuery = pool.executed.find((e) => e.sql.includes('FROM yuncms_roles'));
    assert.ok(lastRoleQuery);
    assert.equal(lastRoleQuery.sql, 'SELECT id, name, description, admin, public, created_at, updated_at FROM yuncms_roles ORDER BY name ASC, id ASC');
    assert.deepEqual(lastRoleQuery.params, []);
  }, { userRows: sampleUsers, roleRows: sampleRoles });
});

test('GET /users forwards query parameters and activates bounded limit/offset/search', async () => {
  await withServer(async (origin, pool) => {
    const res = await fetch(`${origin}/users?limit=15&offset=30&search=alice@example`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(res.status, 200);

    const query = pool.executed.find((e) => e.sql.includes('FROM yuncms_users'));
    assert.ok(query);
    assert.match(query.sql, /WHERE \(`email` LIKE \? ESCAPE '\\\\'\)/);
    assert.match(query.sql, /ORDER BY email ASC, id ASC/);
    assert.match(query.sql, /LIMIT \? OFFSET \?/);
    assert.deepEqual(query.params, ['%alice@example%', 15, 30]);
  });
});

test('GET /roles forwards query parameters and activates bounded limit/offset/search', async () => {
  await withServer(async (origin, pool) => {
    const res = await fetch(`${origin}/roles?limit=5&offset=10&search=editor`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(res.status, 200);

    const query = pool.executed.find((e) => e.sql.includes('FROM yuncms_roles'));
    assert.ok(query);
    assert.match(query.sql, /WHERE \(`name` LIKE \? ESCAPE '\\\\' OR `description` LIKE \? ESCAPE '\\\\'\)/);
    assert.match(query.sql, /ORDER BY name ASC, id ASC/);
    assert.match(query.sql, /LIMIT \? OFFSET \?/);
    assert.deepEqual(query.params, ['%editor%', '%editor%', 5, 10]);
  });
});

test('controlled 400 responses on invalid query parameters across users and roles', async () => {
  const invalidRequests = [
    { url: '/users?fields=id,email', reason: 'unknown fields parameter' },
    { url: '/users?filter={"email":"test"}', reason: 'unknown filter parameter' },
    { url: '/users?sort=email', reason: 'unknown sort parameter' },
    { url: '/users?page=1', reason: 'unknown page parameter' },
    { url: '/users?limit=-1', reason: 'negative limit' },
    { url: '/users?limit=0', reason: 'zero limit' },
    { url: '/users?limit=501', reason: 'limit exceeding 500' },
    { url: '/users?offset=-1', reason: 'negative offset' },
    { url: '/users?offset=1000001', reason: 'offset exceeding 1000000' },
    { url: `/users?search=${'a'.repeat(201)}`, reason: 'search exceeding 200 characters' },
    { url: '/users?limit=10&limit=20', reason: 'duplicate/array limit' },
    { url: '/roles?fields=*', reason: 'unknown fields in roles' },
    { url: '/roles?filter={}', reason: 'unknown filter in roles' },
    { url: '/roles?sort=name', reason: 'unknown sort in roles' },
    { url: '/roles?limit=0', reason: 'zero limit in roles' },
    { url: '/roles?offset=-5', reason: 'negative offset in roles' },
    { url: '/roles?search=a&search=b', reason: 'duplicate/array search in roles' },
  ];

  await withServer(async (origin) => {
    for (const { url, reason } of invalidRequests) {
      const res = await fetch(`${origin}${url}`, {
        headers: { Authorization: 'Bearer admin-token' },
      });
      assert.equal(res.status, 400, `Expected 400 for ${url} (${reason})`);
      const body = await res.json();
      assert.ok(Array.isArray(body.errors), `Expected errors array for ${url}`);
      assert.equal(body.errors[0].code, 'INVALID_QUERY', `Expected INVALID_QUERY code for ${url}`);
    }
  });
});

test('authorization boundaries enforce 401 and 403 on users and roles endpoints', async () => {
  await withServer(async (origin) => {
    const unauthUsers = await fetch(`${origin}/users`);
    assert.equal(unauthUsers.status, 403);
    const unauthRoles = await fetch(`${origin}/roles`);
    assert.equal(unauthRoles.status, 403);

    const deniedUsers = await fetch(`${origin}/users?limit=10`, {
      headers: { Authorization: 'Bearer delegated-denied-token' },
    });
    assert.equal(deniedUsers.status, 403);
    const deniedRoles = await fetch(`${origin}/roles?limit=10`, {
      headers: { Authorization: 'Bearer delegated-denied-token' },
    });
    assert.equal(deniedRoles.status, 403);

    const grantedUsers = await fetch(`${origin}/users?limit=10`, {
      headers: { Authorization: 'Bearer delegated-granted-token' },
    });
    assert.equal(grantedUsers.status, 200);
    const grantedRoles = await fetch(`${origin}/roles?limit=10`, {
      headers: { Authorization: 'Bearer delegated-granted-token' },
    });
    assert.equal(grantedRoles.status, 200);
  });
});
