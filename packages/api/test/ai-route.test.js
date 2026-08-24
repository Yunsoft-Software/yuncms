import assert from 'node:assert/strict';
import test from 'node:test';

import { aiRequestAccess, requireAdministrator, requireAuthenticated } from '../src/routes/ai.js';

test('AI routes reject Public accountability', () => {
  assert.throws(
    () => requireAuthenticated({ authMethod: 'public', accountability: { user: null } }),
    (error) => error.code === 'UNAUTHORIZED',
  );
});

test('AI routes reject requests without an authenticated YunCMS user', () => {
  assert.throws(
    () => requireAuthenticated({ authMethod: 'api_token', accountability: { user: null } }),
    (error) => error.code === 'UNAUTHORIZED',
  );
});

test('AI chat routes accept an authenticated YunCMS identity', () => {
  assert.doesNotThrow(() => requireAuthenticated({
    authMethod: 'api_token',
    accountability: { user: 'user-1', role: 'role-1', admin: false, system: false },
  }));
});

test('AI settings routes require Administrator or system accountability', () => {
  assert.throws(
    () => requireAdministrator({
      authMethod: 'api_token',
      accountability: { user: 'user-1', role: 'role-1', admin: false, system: false },
    }),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.doesNotThrow(() => requireAdministrator({
    authMethod: 'session',
    accountability: { user: 'admin-1', role: 'admin-role', admin: true, system: false },
  }));
});

test('AI chat request access requires writes before delete can be enabled', () => {
  assert.deepEqual(aiRequestAccess({}), { allowWrites: false, allowDeletes: false });
  assert.deepEqual(aiRequestAccess({ allow_deletes: true }), { allowWrites: false, allowDeletes: false });
  assert.deepEqual(aiRequestAccess({ allow_writes: true }), { allowWrites: true, allowDeletes: false });
  assert.deepEqual(aiRequestAccess({ allow_writes: true, allow_deletes: true }), {
    allowWrites: true,
    allowDeletes: true,
  });
});
