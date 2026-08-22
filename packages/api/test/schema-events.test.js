import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emitSchemaLifecycle,
  stableSchemaEvent,
} from '../src/routes/schema.js';

test('schema lifecycle names normalize physical relation variants', () => {
  assert.equal(stableSchemaEvent('schema.collection.create'), 'schema.collection.create');
  assert.equal(stableSchemaEvent('schema.field.alter'), 'schema.field.update');
  assert.equal(stableSchemaEvent('schema.relation.o2o.create'), 'schema.relation.create');
  assert.equal(stableSchemaEvent('schema.relation.m2m.delete'), 'schema.relation.delete');
});

test('schema lifecycle emits specific and broad post-success events without secrets', async () => {
  const events = [];
  const req = {
    id: 'req-schema-1',
    accountability: { user: 'user-1', role: 'admin-role', admin: true, system: false },
    context: {
      emitter: {
        async action(event, payload, context) {
          events.push({ event, payload, context });
        },
      },
    },
  };

  await emitSchemaLifecycle(req, {
    action: 'schema.field.alter',
    collection: 'articles',
    itemKey: 'title',
    payload: {
      after: { field: 'title', schemaVersion: 42 },
      changes: { required: true },
    },
  });

  assert.deepEqual(events.map((entry) => entry.event), [
    'schema.field.update',
    'schema.changed',
  ]);
  assert.equal(events[0].payload.key, 'title');
  assert.equal(events[0].payload.after.schemaVersion, 42);
  assert.equal(events[0].context.accountability, req.accountability);
  assert.equal(events[1].payload.schemaVersion, 42);
  assert.equal(JSON.stringify(events).includes('authorization'), false);
});
