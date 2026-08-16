import assert from 'node:assert/strict';
import test from 'node:test';

import { redactAuditValue } from '../src/services/audit-service.js';

test('audit redaction removes nested secret-shaped values without mutating input', () => {
  const input = {
    email: 'user@example.com',
    password: 'secret',
    nested: {
      refreshToken: 'raw-refresh',
      note: 'visible',
    },
  };

  const output = redactAuditValue(input);
  assert.deepEqual(output, {
    email: 'user@example.com',
    password: '[REDACTED]',
    nested: {
      refreshToken: '[REDACTED]',
      note: 'visible',
    },
  });
  assert.equal(input.password, 'secret');
});

test('audit redaction handles circular structures', () => {
  const input = { name: 'root' };
  input.self = input;
  const output = redactAuditValue(input);
  assert.equal(output.self, '[CIRCULAR]');
});
