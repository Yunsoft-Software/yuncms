import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bootstrapDatabase,
  closeDatabasePool,
  CollectionsService,
  createAccountability,
  createDatabasePool,
  createPublicAccountability,
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
  const secondActorId = `actor-2-${token}`.slice(0, 36);
  const actorEmail = `actor-${token}@example.test`;
  const collections = new CollectionsService({ database: pool, accountability: system });
  const fields = new FieldsService({ database: pool, accountability: system });
  const roles = new RolesService({ database: pool, accountability: system });
  const permissions = new PermissionsService({ database: pool, accountability: system });
  let customRoleId = null;
  let userReadPermissionId = null;
  let publicUserReadPermissionId = null;
  let roleUpdatePermissionId = null;
  let contentReadPermissionId = null;

  try {
    await bootstrapDatabase(pool);
    await pool.query(
      `INSERT INTO yuncms_users (id, email, password_hash, role, status)
       VALUES (?, ?, ?, NULL, 'active'), (?, ?, ?, NULL, 'active')`,
      [
        actorId,
        actorEmail,
        'integration-only-password-hash',
        secondActorId,
        `actor-2-${token}@example.test`,
        'integration-only-password-hash',
      ],
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
    const secondActorItems = new ItemsService(collection, {
      database: pool,
      accountability: createAccountability({ user: secondActorId, admin: true }),
    });
    await secondActorItems.createOne({ title: 'Second actor' });

    const [constraints] = await pool.query(
      `SELECT k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, r.DELETE_RULE
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

    await assert.rejects(
      fields.updateSchema(collection, 'created_at', { required: false }),
      (error) => error.code === 'SYSTEM_SCHEMA_READ_ONLY',
    );
    await assert.rejects(
      fields.deleteOne(collection, 'created_at', { destructive: true }),
      (error) => error.code === 'SYSTEM_SCHEMA_READ_ONLY',
    );

    await fields.updateSchema(collection, 'published_at', { indexed: true });
    const updatedTimestamp = await fields.readOne(collection, 'published_at');
    const updatedTimestampMetadata = parseMetadata(updatedTimestamp.schema_metadata);
    assert.equal(updatedTimestampMetadata.defaultPreset, 'now');
    assert.equal(updatedTimestampMetadata.autoUpdate, true);
    assert.equal(updatedTimestampMetadata.indexed, true);

    const role = await roles.createOne({ name: `Content manager ${token}` });
    customRoleId = role.id;
    const contentReadPermission = await permissions.createOne({
      role: customRoleId,
      collection,
      action: 'read',
      fields: ['id', 'title', 'created_by', 'published_at'],
      filter: {
        _and: [
          { created_by: { _eq: '$CURRENT_USER' } },
          { published_at: { _lte: '$NOW(+1 day)' } },
        ],
      },
    });
    contentReadPermissionId = contentReadPermission.id;
    const firstActorRows = await new ItemsService(collection, {
      database: pool,
      accountability: createAccountability({ user: actorId, role: customRoleId }),
    }).readMany({ sort: 'title' });
    const secondActorRows = await new ItemsService(collection, {
      database: pool,
      accountability: createAccountability({ user: secondActorId, role: customRoleId }),
    }).readMany({ sort: 'title' });
    assert.deepEqual(firstActorRows.map((row) => row.title), ['Changed']);
    assert.deepEqual(secondActorRows.map((row) => row.title), ['Second actor']);

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
    const publicUsers = new UsersService({
      database: pool,
      accountability: createPublicAccountability({ role: publicRoles[0].id }),
    });
    await assert.rejects(
      publicUsers.readMany(),
      (error) => error.code === 'FORBIDDEN',
    );
    const publicUserReadPermission = await permissions.createOne({
      role: publicRoles[0].id,
      collection: 'yuncms_users',
      action: 'read',
    });
    publicUserReadPermissionId = publicUserReadPermission.id;
    assert.equal((await publicUsers.readMany()).some((user) => user.id === actorId), true);

    const delegatedRoles = new RolesService({
      database: pool,
      accountability: createAccountability({ user: actorId, role: customRoleId }),
    });
    await assert.rejects(
      delegatedRoles.updateOne(customRoleId, { description: 'Before grant' }),
      (error) => error.code === 'FORBIDDEN',
    );
    const roleUpdatePermission = await permissions.createOne({
      role: customRoleId,
      collection: 'yuncms_roles',
      action: 'update',
    });
    roleUpdatePermissionId = roleUpdatePermission.id;
    const updatedRole = await delegatedRoles.updateOne(customRoleId, { description: 'Delegated' });
    assert.equal(updatedRole.description, 'Delegated');

    await pool.query('DELETE FROM yuncms_users WHERE id = ?', [actorId]);
    const preserved = await items.readOne(created.id);
    assert.equal(preserved.created_by, null);
    assert.equal(preserved.updated_by, null);
  } finally {
    if (contentReadPermissionId) await permissions.deleteOne(contentReadPermissionId).catch(() => {});
    if (roleUpdatePermissionId) await permissions.deleteOne(roleUpdatePermissionId).catch(() => {});
    if (publicUserReadPermissionId) await permissions.deleteOne(publicUserReadPermissionId).catch(() => {});
    if (userReadPermissionId) await permissions.deleteOne(userReadPermissionId).catch(() => {});
    if (customRoleId) await roles.deleteOne(customRoleId).catch(() => {});
    await collections.deleteOne(collection, { destructive: true }).catch(() => {});
    await pool.query('DELETE FROM yuncms_users WHERE id = ?', [actorId]).catch(() => {});
    await pool.query('DELETE FROM yuncms_users WHERE id = ?', [secondActorId]).catch(() => {});
    await closeDatabasePool(pool);
  }
});
