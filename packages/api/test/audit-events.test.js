import assert from 'node:assert/strict';
import test from 'node:test';

import { INTERNAL_AUDIT_EVENTS } from '../src/audit-events.js';

test('internal audit coverage includes authorization-sensitive mutations', () => {
  for (const event of [
    'users.create',
    'users.update',
    'users.delete',
    'users.password.update',
    'roles.create',
    'roles.update',
    'roles.delete',
    'permissions.create',
    'permissions.update',
    'permissions.delete',
  ]) {
    assert.equal(INTERNAL_AUDIT_EVENTS.includes(event), true, `missing audit event: ${event}`);
  }
});
