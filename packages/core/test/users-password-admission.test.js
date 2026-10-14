import assert from 'node:assert/strict';
import test from 'node:test';
import { ExtensionError } from '@yunsoft/yuncms-extensions-sdk';
import { createAccountability, createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import { verifyPassword } from '../src/auth/password.js';
import { HookEmitter } from '../src/hooks.js';
import { UsersService } from '../src/services/users-service.js';
import { withTransaction } from '../src/transaction.js';

function fixture(accountability = createSystemAccountability()) {
  const calls = [], emitter = new HookEmitter(), before = { id: 'operator', email: 'operator@example.test', role: 'staff', status: 'active' };
  const connection = {
    async beginTransaction() { calls.push('begin'); }, async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); }, release() { calls.push('release'); },
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT')) return [[before]];
      return [{ affectedRows: 1 }];
    },
  };
  const pool = { async getConnection() { calls.push('borrow'); return connection; } };
  const service = database => new UsersService({ database: database ?? pool, accountability, emitter, requestId: 'password-admission' });
  return { calls, emitter, connection, pool, service, before };
}

test('password admission veto preserves credentials and sessions and rolls back policy writes', async () => {
  const f = fixture(createAccountability({ user: 'customer', admin: true }));
  f.emitter.registerFilter('users.password.update', async (payload, ctx) => {
    assert.deepEqual(payload, { key: 'operator' }); assert.equal(ctx.key, 'operator');
    assert.equal(ctx.accountability.user, 'customer'); assert.equal(ctx.accountability.admin, true);
    assert.equal(ctx.requestId, 'password-admission'); assert.equal(ctx.operation, 'update');
    assert.equal(ctx.database, f.connection); assert.deepEqual(ctx.transaction, { managed: true, state: 'active' });
    assert.deepEqual(ctx.before, f.before); assert.equal(ctx.before.password_hash, undefined);
    assert.match(f.calls.find(x => x?.sql?.startsWith('SELECT')).sql, /FOR UPDATE$/);
    await ctx.database.query('UPDATE application_policy SET attempts = attempts + 1');
    throw new ExtensionError('OPERATOR_USER_PROTECTED', 'Protected operator', { status: 403 });
  });
  let actions = 0; f.emitter.registerAction('users.password.update', () => { actions++; });
  await assert.rejects(f.service().updatePassword('operator', 'Requested-password!'), { code: 'OPERATOR_USER_PROTECTED', status: 403 });
  assert.equal(f.calls.some(x => /password_hash|DELETE FROM yuncms_sessions/.test(x?.sql)), false);
  assert.equal(f.calls.includes('rollback'), true); assert.equal(f.calls.includes('commit'), false);
  assert.equal(f.calls.at(-1), 'release'); assert.equal(actions, 0);
});

test('password admission is veto-only and actions disclose no password after commit and connection release', async () => {
  const f = fixture(createAccountability({ user: 'operator', role: 'staff' }));
  f.emitter.registerFilter('users.password.update', (payload, ctx) => {
    assert.equal(ctx.accountability.user, 'operator'); payload.key = 'forged';
    return { key: 'forged', password: 'Forged-password!' };
  });
  const events = []; f.emitter.registerAction('users.password.update', (payload, ctx) => {
    assert.equal(f.calls.at(-1), 'release'); assert.equal(ctx.database, f.pool);
    assert.deepEqual(ctx.transaction, { managed: true, state: 'committed' }); events.push({ payload, ctx });
  });
  assert.equal(await f.service().updatePassword('operator', 'Requested-password!'), true);
  const write = f.calls.find(x => x?.sql?.startsWith('UPDATE yuncms_users SET password_hash'));
  assert.equal(write.params[1], 'operator'); assert.equal(await verifyPassword('Requested-password!', write.params[0]), true);
  assert.deepEqual(f.calls.find(x => x?.sql?.startsWith('DELETE')).params, ['operator']);
  assert.equal(events.length, 1); assert.deepEqual(events[0].payload, { key: 'operator' });
  assert.equal(JSON.stringify(events[0].payload).includes('password'), false);
});

test('password changes join caller-owned transactions and suppress actions on rollback or commit failure', async () => {
  for (const failure of ['outer', 'commit']) {
    const f = fixture(); let actions = 0;
    f.emitter.registerAction('users.password.update', () => { actions++; });
    if (failure === 'commit') f.connection.commit = async () => { throw Error('commit failure'); };
    await assert.rejects(withTransaction(f.pool, async database => {
      await f.service(database).updatePassword('operator', 'Requested-password!');
      assert.equal(actions, 0); if (failure === 'outer') throw Error('outer failure');
    }), /failure/);
    assert.equal(f.calls.filter(x => x === 'borrow').length, 1);
    assert.equal(f.calls.filter(x => x === 'begin').length, 1);
    assert.equal(f.calls.includes('rollback'), true); assert.equal(actions, 0);
  }
});

test('system password operations still consult admission and preserve caller-owned connection ownership', async () => {
  const f = fixture(); let filters = 0, actions = 0;
  f.emitter.registerFilter('users.password.update', (_p, ctx) => { filters++; assert.equal(ctx.accountability.system, true); });
  f.emitter.registerAction('users.password.update', (_p, ctx) => { actions++; assert.equal(ctx.database, f.connection); });
  await f.service(f.connection).updatePassword('operator', 'Requested-password!');
  assert.equal(filters, 1); assert.equal(actions, 1); assert.equal(f.calls.includes('release'), false);
});

test('public callers and delegated managers cannot consult admission or change foreign passwords', async () => {
  for (const accountability of [createPublicAccountability(), createAccountability({ user: 'staff', role: 'staff' })]) {
    const f = fixture(accountability); let filters = 0;
    f.emitter.registerFilter('users.password.update', () => { filters++; });
    await assert.rejects(f.service().updatePassword('operator', 'Requested-password!'), { code: 'FORBIDDEN' });
    assert.deepEqual(f.calls, []); assert.equal(filters, 0);
  }
});

test('invalid password input is rejected before admission or transaction acquisition', async () => {
  const f = fixture(); let filters = 0;
  f.emitter.registerFilter('users.password.update', () => { filters++; });
  for (const password of [undefined, {}, 'short', 'x'.repeat(1025)]) {
    await assert.rejects(f.service().updatePassword('operator', password), { code: 'INVALID_PASSWORD' });
  }
  assert.deepEqual(f.calls, []); assert.equal(filters, 0);
});

test('a missing password target cannot run admission or emit success', async () => {
  const f = fixture(); f.connection.query = async () => [[]]; let filters = 0, actions = 0;
  f.emitter.registerFilter('users.password.update', () => { filters++; });
  f.emitter.registerAction('users.password.update', () => { actions++; });
  await assert.rejects(f.service().updatePassword('missing', 'Requested-password!'), { code: 'USER_NOT_FOUND' });
  assert.equal(filters, 0); assert.equal(actions, 0); assert.equal(f.calls.includes('rollback'), true);
});
