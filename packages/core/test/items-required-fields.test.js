import test from 'node:test';
import assert from 'node:assert/strict';
import { ItemsService } from '../src/services/items-service.js';

const field = (name, type, extra = {}) => ({ field: name, type, required: true, ...extra });
const schema = { primary_key: 'id', fields: {
  id: field('id', 'uuid', { readonly: true }),
  title: field('title', 'string'), quantity: field('quantity', 'integer'), active: field('active', 'boolean'),
  optional: field('optional', 'string', { required: false }),
  defaulted: field('defaulted', 'integer', { schema_metadata: { defaultValue: 7 } }),
  created_at: field('created_at', 'datetime', { readonly: true, schema_metadata: { systemManaged: true, defaultPreset: 'now' } }),
} };
const valid = { title: 'Required values', quantity: 0, active: false };
// Exercise the actual pure payload validator directly; no database or service doubles.
const validate = (payload, creating = false, permission = { action: creating ? 'create' : 'update' }) =>
  ItemsService.prototype.validatePayload(payload, schema, permission, { creating });

for (const creating of [true, false]) for (const name of ['title', 'quantity', 'active', 'defaulted']) {
  test(`required ${name} rejects explicit null on ${creating ? 'create' : 'update'}`, () => {
    assert.throws(() => validate({ ...(creating ? valid : {}), [name]: null }, creating), {
      code: 'REQUIRED_FIELD_MISSING', path: name,
    });
  });
}
test('zero, false and nullable null remain valid; partial updates do not require omitted fields', () => {
  assert.deepEqual(validate({ ...valid, optional: null }, true), Object.entries({ ...valid, optional: null }));
  assert.deepEqual(validate({ quantity: 0, active: false }), [['quantity', 0], ['active', false]]);
  assert.deepEqual(validate({ optional: null }), [['optional', null]]);
});
test('omitted required fields still fail, while literal defaults and server fields may be omitted', () => {
  assert.doesNotThrow(() => validate(valid, true));
  assert.throws(() => validate({ quantity: 0, active: false }, true), { code: 'REQUIRED_FIELD_MISSING', path: 'title' });
});
test('read-only and field permission checks retain precedence over value validation', () => {
  assert.throws(() => validate({ created_at: null }), { code: 'FIELD_READ_ONLY', path: 'created_at' });
  assert.throws(() => validate({ title: null }, false, { action: 'update', fields: ['quantity'] }), { code: 'FORBIDDEN_FIELD', path: 'title' });
});
