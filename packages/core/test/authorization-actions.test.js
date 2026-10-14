import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import { PermissionsService } from '../src/services/permissions-service.js';
import { RolesService } from '../src/services/roles-service.js';
import { withConnectionTransaction, withTransaction } from '../src/transaction.js';

for (const [Service, collection, prefix] of [[PermissionsService, 'yuncms_permissions', 'permissions'], [RolesService, 'yuncms_roles', 'roles']]) {
  test(`${prefix} actions wait for commit, preserve order and carry the caller-owned connection and actor`, async () => {
    const calls = [], events = [], accountability = createSystemAccountability();
    const connection = { async beginTransaction() { calls.push('begin'); }, async commit() { calls.push('commit'); }, async rollback() { calls.push('rollback'); } };
    const emitter = { async action(event, payload, ctx) { events.push({ event, payload, ctx }); assert.ok(calls.includes('commit')); } };
    const service = new Service({ database: connection, accountability, requestId: 'audit-request', emitter });
    const created = { key: 'target', item: { name: 'original' } };
    await withConnectionTransaction(connection, async () => {
      for (const operation of ['create', 'update', 'delete']) await service.action(`${prefix}.${operation}`, created);
      assert.deepEqual(events, []);
      created.item.name = 'caller-mutated';
      service.accountability = createPublicAccountability();
      service.requestId = 'caller-mutated';
    });
    assert.deepEqual(events.map(e => e.event), [`${prefix}.create`, `${prefix}.update`, `${prefix}.delete`]);
    for (const { payload, ctx } of events) {
      assert.equal(payload.item.name, 'original'); assert.equal(ctx.database, connection); assert.equal(ctx.accountability, accountability);
      assert.equal(ctx.requestId, 'audit-request'); assert.equal(ctx.collection, collection); assert.deepEqual(ctx.transaction, { managed: true, state: 'committed' });
    }
  });

  test(`${prefix} actions are discarded on rollback and commit failure`, async () => {
    for (const commitFailure of [false, true]) {
      const events = [], connection = { async beginTransaction() {}, async rollback() {}, async commit() { if (commitFailure) throw Error('Commit failed'); } };
      const service = new Service({ database: connection, accountability: createSystemAccountability(), emitter: { async action(event) { events.push(event); } } });
      await assert.rejects(withConnectionTransaction(connection, async () => {
        for (const operation of ['create', 'update', 'delete']) await service.action(`${prefix}.${operation}`, { key: 'target' });
        if (!commitFailure) throw Error('Operation failed');
      }));
      assert.deepEqual(events, []);
    }
  });

  test(`${prefix} actions from borrowed connections run after release with a usable pool`, async () => {
    let released = false, called = 0;
    const connection = { async beginTransaction() {}, async commit() {}, async rollback() {}, release() { released = true; } };
    const pool = { async getConnection() { return connection; } };
    await withTransaction(pool, async database => {
      const service = new Service({ database, accountability: createSystemAccountability(), emitter: { async action(_event, _payload, ctx) {
        called++; assert.equal(released, true); assert.equal(ctx.database, pool); assert.deepEqual(ctx.transaction, { managed: true, state: 'committed' });
      } } });
      await service.action(`${prefix}.create`, { key: 'target' }); assert.equal(called, 0);
    });
    assert.equal(called, 1);
  });

  test(`${prefix} actions outside a managed transaction retain immediate behavior and supply the database`, async () => {
    const database = {}, events = [];
    const service = new Service({ database, accountability: createSystemAccountability(), emitter: { async action(event, _payload, ctx) { events.push(event); assert.equal(ctx.database, database); assert.equal(ctx.transaction, null); } } });
    await service.action(`${prefix}.create`, { key: 'target' }); assert.deepEqual(events, [`${prefix}.create`]);
    await new Service({ database, accountability: createSystemAccountability() }).action(`${prefix}.create`, { key: 'target' });
  });
}
