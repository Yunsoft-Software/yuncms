import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bootstrapDatabase,
  closeDatabasePool,
  CollectionsService,
  createAccountability,
  createDatabasePool,
  createSystemAccountability,
  FieldsService,
  ItemsService,
  loadConfig,
  PermissionsService,
  RolesService,
  UsersService,
} from '@yunsoft/yuncms-core';

const ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(-10);
}

function requireDisposableDatabase(config) {
  if (!DESTRUCTIVE) throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required');
  if (!/(test|ci|dev)/i.test(config.database.database)) {
    throw new Error(`Integration DB name must contain test, ci or dev: ${config.database.database}`);
  }
}

function parseMetadata(value) {
  if (!value) return {};
  return typeof value === 'object' ? value : JSON.parse(value);
}

test('real MySQL creates Directus-style accountability fields and delegates bounded system resources', {
  skip: !ENABLED,
  timeout: 60_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);
  const system = createSystemAccountability();
  const token = suffix();
  const collection = `it_accountability_${token}`;
  const actorId = `actor-${token}`.slice(0, 36);
  const actorEmail = `actor-${token}@example.test`;
  const collections = new CollectionsService({ database: pool, accountability: system });
  const fields = new FieldsService({ database: pool, accountability: system });
  const roles = new RolesService({ database: pool, accountability: system });
  const permissions = new PermissionsService({ database: pool, accountability: system });
  let customRoleId = null;
  let userReadPermissionId = null;

  try {
    await bootstrapDatabase(pool);
    await pool.query(
      `INSERT INTO yuncms_users (id, email, password_hash, role, status)
       VALUES (?, ?, ?, NULL, 'active')`,
      [actorId, actorEmail, 'integration-only-password-hash'],
    );

    await collections.createOne({
      collection,
      systemFields: ['created_at', 'updated_at', 'created_by', 'updated_by'],
    });

    const systemFieldRows = await fields.readMany(collection);
    const byName = new Map(systemFieldRows.map((field) => [field.field, field]));
    for (const name of ['created_at', 'updated_at', 'created_by', 'updated_by']) {
      assert.ok(byName.has(name), `${name} metadata should exist`);
      assert.equal(parseMetadata(byName.get(name).schema_metadata).systemManaged, true);
    }
    assert.equal(byName.get('created_by').readonly, 1);
    assert.equal(byName.get('updated_by').interface, 'user');

    await fields.createOne(collection, {
      field: 'title',
      type: 'string',
      required: true,
      length: 180,
    });
    await fields.createOne(collection, {
      field: 'published_at',
      type: 'timestamp',
      required: true,
      defaultPreset: 'now',
      autoUpdate: true,
    });

    const actor = createAccountability({ user: actorId, admin: true, role: null });
    const items = new ItemsService(collection, { database: pool, accountability: actor });
    const created = await items.createOne({ title: 'First' });
    assert.equal(created.created_by, actorId);
    assert.equal(created.updated_by, actorId);
    assert.ok(created.created_at);
    assert.ok(created.updated_at);
    assert.ok(created.published_at);

    const updated = await items.updateOne(created.id, { title: 'Changed' });
    assert.equal(updated.created_by, actorId);
    assert.equal(updated.updated_by, actorId);
    assert.ok(new Date(updated.updated_at).getTime() >= new Date(created.updated_at).getTime());

    const [constraints] = await pool.query(
      `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, DELETE_RULE
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
       JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
       WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ?
         AND k.COLUMN_NAME IN ('created_by', 'updated_by')`,
      [config.database.database, collection],
    );
    assert.equal(constraints.length, 2);
    assert.equal(constraints.every((row) => row.REFERENCED_TABLE_NAME === 'yuncms_users'), true);
    assert.equal(constraints.every((row) => row.DELETE_RULE === 'SET NULL'), true);

    const role = await roles.createOne({ name: `Content manager ${token}` });
    customRoleId = role.id;
    const permission = await permissions.createOne({
      role: customRoleId,
      collection: 'yuncms_users',
      action: 'read',
    });
    userReadPermissionId = permission.id;

    const delegatedUsers = new UsersService({
      database: pool,
      accountability: createAccountability({ user: actorId, role: customRoleId }),
    });
    const userRows = await delegatedUsers.readMany();
    assert.equal(userRows.some((user) => user.id === actorId), true);

    const [publicRoles] = await pool.query('SELECT id FROM yuncms_roles WHERE public = 1 LIMIT 1');
    await assert.rejects(
      permissions.createOne({
        role: publicRoles[0].id,
        collection: 'yuncms_users',
        action: 'read',
      }),
      (error) => error.code === 'PUBLIC_SYSTEM_ACCESS_FORBIDDEN',
    );
    await assert.rejects(
      permissions.createOne({
        role: customRoleId,
        collection: 'yuncms_roles',
        action: 'update',
      }),
      (error) => error.code === 'SYSTEM_PERMISSION_ACTION_PROTECTED',
    );
  } finally {
    if (userReadPermissionId) await permissions.deleteOne(userReadPermissionId).catch(() => {});
    if (customRoleId) await roles.deleteOne(customRoleId).catch(() => {});
    await collections.deleteOne(collection, { destructive: true }).catch(() => {});
    await pool.query('DELETE FROM yuncms_users WHERE id = ?', [actorId]).catch(() => {});
    await closeDatabasePool(pool);
  }
});
