import assert from 'node:assert/strict';
import test from 'node:test';

import { requireAuthenticated } from '../src/routes/ai.js';

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

test('AI routes accept an authenticated YunCMS identity', () => {
  assert.doesNotThrow(() => requireAuthenticated({
    authMethod: 'api_token',
    accountability: { user: 'user-1', role: 'role-1', admin: false, system: false },
  }));
});
