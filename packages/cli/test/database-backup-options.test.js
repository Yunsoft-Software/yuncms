import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDatabaseClientArgs } from '../src/database-backup.js';

test('managed database dump uses transaction-safe least-privilege options', () => {
  const args = buildDatabaseClientArgs({
    host: '127.0.0.1',
    port: 3306,
    database: 'yuncms',
    user: 'yuncms',
    password: 'secret',
    ssl: false,
  }, { dump: true });

  assert.ok(args.includes('--single-transaction'));
  assert.ok(args.includes('--quick'));
  assert.ok(args.includes('--hex-blob'));
  assert.ok(args.includes('--triggers'));
  assert.ok(args.includes('--no-tablespaces'));
  assert.equal(args.includes('--routines'), false);
  assert.equal(args.includes('--events'), false);
  assert.equal(args.some((arg) => arg.includes('secret')), false);
});
