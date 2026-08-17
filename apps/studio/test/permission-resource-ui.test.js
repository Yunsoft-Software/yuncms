import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canConfigurePermission,
  canUseAdvancedPermission,
  isPermissionCollection,
  permissionResourcePolicy,
} from '../src/permission-resource-ui.js';

const users = {
  collection: 'yuncms_users',
  system: 1,
  metadata: {
    permissionManaged: true,
    permissionMode: 'action-only',
    resource: 'users',
    allowedActions: ['read', 'create', 'update', 'delete'],
  },
};

const roles = {
  collection: 'yuncms_roles',
  system: 1,
  metadata: JSON.stringify({
    permissionManaged: true,
    permissionMode: 'action-only',
    resource: 'roles',
    allowedActions: ['read'],
  }),
};

const internal = { collection: 'yuncms_permissions', system: 1, metadata: null };
const project = { collection: 'articles', system: 0, metadata: null };

test('only explicitly permission-managed system resources enter the role matrix', () => {
  assert.equal(isPermissionCollection(project), true);
  assert.equal(isPermissionCollection(users), true);
  assert.equal(isPermissionCollection(roles), true);
  assert.equal(isPermissionCollection(internal), false);
});

test('system resource action policy is reflected in Studio controls', () => {
  assert.equal(canConfigurePermission(users, 'update', { public: false }), true);
  assert.equal(canConfigurePermission(roles, 'read', { public: false }), true);
  assert.equal(canConfigurePermission(roles, 'create', { public: false }), false);
  assert.equal(canConfigurePermission(users, 'read', { public: true }), false);
  assert.equal(canUseAdvancedPermission(users), false);
  assert.equal(canUseAdvancedPermission(project), true);
  assert.equal(permissionResourcePolicy(users).resource, 'users');
});
