import assert from 'node:assert/strict';
import test from 'node:test';

import { createSystemAccountability } from '../src/accountability.js';
import { AuditService } from '../src/services/audit-service.js';

test('audit cleanup deletes in bounded batches and stops when a batch is incomplete', async () => {
  const calls = [];
  const affected = [2, 1];
  const database = {
    async query(sql, params) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return [{ affectedRows: affected.shift() ?? 0 }, []];
    },
  };
  const service = new AuditService({
    accountability: createSystemAccountability(),
    database,
  });

  const result = await service.cleanup({ retentionDays: 30, batchSize: 2, maxBatches: 10 });
  assert.equal(result.deleted, 3);
  assert.equal(result.batches, 2);
  assert.equal(result.complete, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /DELETE FROM yuncms_audit_log WHERE created_at < \? ORDER BY id ASC LIMIT \?/);
  assert.equal(calls[0].params[1], 2);
});

test('audit cleanup reports incomplete when the max batch guard is reached', async () => {
  const database = {
    async query() {
      return [{ affectedRows: 5 }, []];
    },
  };
  const service = new AuditService({
    accountability: createSystemAccountability(),
    database,
  });

  const result = await service.cleanup({ retentionDays: 30, batchSize: 5, maxBatches: 2 });
  assert.equal(result.deleted, 10);
  assert.equal(result.batches, 2);
  assert.equal(result.complete, false);
});
