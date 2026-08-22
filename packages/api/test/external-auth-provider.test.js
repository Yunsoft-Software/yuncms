import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeLdapSubject } from '../src/external-auth/providers.js';

test('LDAP subject normalization preserves string ids and stabilizes binary objectGUID values', () => {
  assert.equal(normalizeLdapSubject(' 550e8400-e29b-41d4-a716-446655440000 '), '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(normalizeLdapSubject(Buffer.from([0x01, 0x02, 0xfe, 0xff])), 'hex:0102feff');
  assert.equal(normalizeLdapSubject(new Uint8Array([0xaa, 0xbb])), 'hex:aabb');
  assert.equal(normalizeLdapSubject(''), null);
  assert.equal(normalizeLdapSubject(['a', 'b']), null);
});
