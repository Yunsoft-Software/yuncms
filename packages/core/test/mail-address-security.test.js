import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const parse = require('nodemailer/lib/addressparser');

test('nested display-name comments cannot replace the intended mail recipient', () => {
  const addresses = parse('Victim (x(y) <evil@evil.invalid>) <v@victim.invalid>');
  assert.deepEqual(addresses.map(({ address }) => address), ['v@victim.invalid']);
});
