import assert from 'node:assert/strict';
import test from 'node:test';
import { createInterruptedFieldFixture } from '../helpers/interrupted-field-fixture.mjs';
import { fieldIndexName } from '../../packages/core/src/field-index.js';

test('real SIGKILL after field DDL: explicit recovery preserves data, native authorization and schema version', {
  // Seven real recovery scenarios include child-process termination, multiple
  // physical DDL operations and a deliberate one-second MySQL lock timeout.
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 180000,
}, async t => {
  const f = await createInterruptedFieldFixture(); let accepted = false;
  try {
    const evidence = await f.interrupt(); assert.equal(evidence.signal, 'SIGKILL');
    const beforeVersion = await f.version();
    await f.database.query('UPDATE recovery_records SET content=? WHERE id=?', ['Content preserved after interruption', f.row.id]);
    await assert.rejects(f.fields.createOne('recovery_records', evidence.definition), { code: 'SCHEMA_RECOVERY_REQUIRED' });
    assert.equal(await f.version(), beforeVersion); assert.equal(await f.fields.readOne('recovery_records', 'content'), null);
    const admin = await f.login(f.admin), staff = await f.login(f.staff);
    const path = '/schema/collections/recovery_records/fields/content/recovery';
    const inspect = token => f.request(path + '/inspect', { method: 'POST', token, body: { definition: evidence.definition } });
    assert.equal((await inspect(staff)).status, 403); assert.equal((await inspect(null)).status, 403);
    const preview = await inspect(admin); assert.equal(preview.status, 200); assert.equal(preview.body.data.compatible, true);
    const confirmation = { definition: evidence.definition, expectedSignature: preview.body.data.signature, confirm: true };
    await t.test('explicit confirmation and exact current physical signature are required', async () => {
      for (const body of [{ ...confirmation, confirm: false }, { ...confirmation, expectedSignature: '0'.repeat(64) }, { ...confirmation, definition: { field: 'content', type: 'integer' } }]) {
        const result = await f.request(path, { token: admin, method: 'POST', body });
        assert.ok([400, 409].includes(result.status));
        assert.equal(await f.fields.readOne('recovery_records', 'content'), null); assert.equal(await f.version(), beforeVersion);
      }
      assert.equal((await f.request(path, { token: staff, method: 'POST', body: confirmation })).status, 403);
    });
    await t.test('native admission rejection rolls back and cannot adopt an unapproved definition', async () => {
      const off = f.emitter.registerFilter('schema.field.create', () => { throw Object.assign(Error('Native policy denied recovery'), { code: 'FORBIDDEN' }); });
      try { assert.equal((await f.request(path, { token: admin, method: 'POST', body: confirmation })).status, 403); }
      finally { off(); }
      assert.equal(await f.fields.readOne('recovery_records', 'content'), null); assert.equal(await f.version(), beforeVersion);
    });
    await t.test('a real metadata transaction timeout preserves the physical column and remains retryable', async () => {
      const blocker = await f.database.getConnection(), recovery = await f.database.getConnection();
      try {
        await blocker.beginTransaction(); await blocker.query('SELECT version FROM yuncms_schema_state WHERE id=1 FOR UPDATE');
        await recovery.query('SET SESSION innodb_lock_wait_timeout=1');
        const Service = f.fields.constructor;
        await assert.rejects(new Service({ ...f.options, database: recovery }).recoverOne('recovery_records', 'content', confirmation), { code: 'ER_LOCK_WAIT_TIMEOUT' });
      } finally { await blocker.rollback(); blocker.release(); await recovery.query('SET SESSION innodb_lock_wait_timeout=50'); recovery.release(); }
      assert.equal(await f.fields.readOne('recovery_records', 'content'), null); assert.equal(await f.version(), beforeVersion);
      const [[row]] = await f.database.query('SELECT content FROM recovery_records WHERE id=?', [f.row.id]); assert.equal(row.content, 'Content preserved after interruption');
    });
    await t.test('two real concurrent confirmations commit metadata and version exactly once', async () => {
      const results = await Promise.all([1, 2].map(() => f.request(path, { token: admin, method: 'POST', body: confirmation })));
      assert.deepEqual(results.map(x => x.status).sort(), [201, 409]); assert.equal(await f.version(), beforeVersion + 1);
      const [[count]] = await f.database.query("SELECT COUNT(*) n FROM yuncms_fields WHERE collection='recovery_records' AND field='content'"); assert.equal(Number(count.n), 1);
      const [[row]] = await f.database.query('SELECT title,content FROM recovery_records WHERE id=?', [f.row.id]);
      assert.deepEqual(row, { title: 'Existing data survives', content: 'Content preserved after interruption' });
      const native = await f.request('/items/recovery_records/' + f.row.id, { token: admin });
      assert.equal(native.status, 200); assert.equal(native.body.data.content, row.content);
    });
    await t.test('unknown physical columns are never automatically adopted and stale previews cannot mutate schema', async () => {
      await f.database.query('ALTER TABLE recovery_records ADD COLUMN unknown_value VARCHAR(40) NULL');
      const definition = { field: 'unknown_value', type: 'string', length: 40 };
      await assert.rejects(f.fields.createOne('recovery_records', definition), { code: 'SCHEMA_RECOVERY_REQUIRED' });
      const p = await f.fields.inspectRecovery('recovery_records', 'unknown_value', definition);
      assert.equal(p.compatible, true);
      await f.database.query('ALTER TABLE recovery_records MODIFY COLUMN unknown_value VARCHAR(60) NULL');
      await assert.rejects(f.fields.recoverOne('recovery_records', 'unknown_value', { definition, confirm: true, expectedSignature: p.signature }), { code: 'SCHEMA_RECOVERY_MISMATCH' });
      assert.equal(await f.fields.readOne('recovery_records', 'unknown_value'), null);
      assert.equal((await f.fields.inspectRecovery('recovery_records', 'unknown_value', { ...definition, length: 60 })).compatible, true);
      await assert.rejects(f.fields.inspectRecovery('yuncms_users', 'email', { field: 'email', type: 'string' }), { code: 'SYSTEM_SCHEMA_READ_ONLY' });
      const exact = { ...definition, length: 60 }, fresh = await f.fields.inspectRecovery('recovery_records', 'unknown_value', exact);
      await f.fields.createOne('recovery_records', { field: 'another_field', type: 'string' });
      await assert.rejects(f.fields.recoverOne('recovery_records', 'unknown_value', { definition: exact, confirm: true, expectedSignature: fresh.signature }), { code: 'SCHEMA_RECOVERY_STALE' });
    });
    await t.test('real interrupted indexed/default field recovers its exact physical index without DDL on the original', async () => {
      const definition = { field: 'quantity', type: 'integer', defaultValue: 0, indexed: true };
      await f.interrupt(definition);
      const preview = await f.fields.inspectRecovery('recovery_records', 'quantity', definition); assert.equal(preview.compatible, true);
      const before = (await f.database.query('SHOW CREATE TABLE recovery_records'))[0];
      await f.fields.recoverOne('recovery_records', 'quantity', { definition, confirm: true, expectedSignature: preview.signature });
      assert.deepEqual((await f.database.query('SHOW CREATE TABLE recovery_records'))[0], before);
      const [[row]] = await f.database.query('SELECT quantity FROM recovery_records WHERE id=?', [f.row.id]); assert.equal(row.quantity, 0);
    });
    await t.test('unmodelled foreign keys and check constraints prevent metadata adoption', async () => {
      await f.database.query('ALTER TABLE recovery_records ADD COLUMN checked_value INT NULL CHECK(checked_value > 0)');
      assert.equal((await f.fields.inspectRecovery('recovery_records', 'checked_value', { field: 'checked_value', type: 'integer' })).compatible, false);
      await f.database.query('ALTER TABLE recovery_records ADD COLUMN parent_ref CHAR(36) NULL, ADD FOREIGN KEY(parent_ref) REFERENCES recovery_records(id)');
      const self = await f.fields.inspectRecovery('recovery_records', 'parent_ref', { field: 'parent_ref', type: 'uuid' });
      assert.equal(self.compatible, false);
      assert.equal(self.physical.foreignKeys.filter(row => row.COLUMN_NAME === 'parent_ref').length, 1, 'A same-table reference is inspected once');
      // MySQL permits references between columns in the same table, but not a
      // column referencing itself. Use an independent native-compatible target.
      await f.database.query('ALTER TABLE recovery_records ADD COLUMN referenced_value CHAR(36) NULL');
      await f.database.query('UPDATE recovery_records SET referenced_value=id');
      await f.database.query('ALTER TABLE recovery_records MODIFY referenced_value CHAR(36) NOT NULL, ADD UNIQUE INDEX `' + fieldIndexName('recovery_records', 'referenced_value') + '`(referenced_value)');
      const referencedDefinition = { field: 'referenced_value', type: 'uuid', unique: true, required: true };
      assert.equal((await f.fields.inspectRecovery('recovery_records', 'referenced_value', referencedDefinition)).compatible, true);
      const external = f.dbName + '_refs';
      assert.match(external, /^yuncms_test_recovery_[a-z0-9_]+$/);
      let created = false;
      try {
        const [[table]] = await f.database.query("SELECT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='recovery_records'");
        assert.match(table.TABLE_COLLATION, /^[a-z0-9_]+$/);
        await f.database.query('CREATE DATABASE `' + external + '` CHARACTER SET utf8mb4 COLLATE ' + table.TABLE_COLLATION); created = true;
        await f.database.query('CREATE TABLE `' + external + '`.outside_links (ref CHAR(36) NULL, CONSTRAINT recovery_external_ref FOREIGN KEY(ref) REFERENCES `' + f.dbName + '`.recovery_records(referenced_value)) ENGINE=InnoDB');
        const incoming = await f.fields.inspectRecovery('recovery_records', 'referenced_value', referencedDefinition);
        assert.equal(incoming.compatible, false);
        assert.equal(incoming.physical.foreignKeys.filter(row => row.CONSTRAINT_NAME === 'recovery_external_ref').length, 1, 'Incoming references from another database remain protected');
      } finally { if (created) await f.database.query('DROP DATABASE `' + external + '`'); }
      assert.equal(await f.fields.readOne('recovery_records', 'checked_value'), null); assert.equal(await f.fields.readOne('recovery_records', 'parent_ref'), null);
    });
    accepted = true;
  } finally { await f.close({ preserve: !accepted }); }
});
