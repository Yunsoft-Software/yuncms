import assert from 'node:assert/strict';
import test from 'node:test';

import { createJsonLogger } from '../src/logger.js';

function capture() {
  const chunks = [];
  return {
    chunks,
    write(chunk) { chunks.push(chunk); },
  };
}

test('structured logger emits JSON and redacts sensitive-key values', () => {
  const output = capture();
  const logger = createJsonLogger({
    output,
    errorOutput: output,
    now: () => new Date('2026-08-17T00:00:00.000Z'),
  });

  logger.info('request', {
    requestId: 'req-1',
    password: 'never-log-this',
    nested: { access_token: 'secret-token', safe: 'visible' },
  });

  const record = JSON.parse(output.chunks.join('').trim());
  assert.equal(record.level, 'info');
  assert.equal(record.requestId, 'req-1');
  assert.equal(record.password, '[REDACTED]');
  assert.equal(record.nested.access_token, '[REDACTED]');
  assert.equal(record.nested.safe, 'visible');
});

test('logger level threshold drops lower-priority messages', () => {
  const output = capture();
  const logger = createJsonLogger({ level: 'warn', output, errorOutput: output });
  logger.info('ignored');
  logger.warn('kept');
  assert.equal(output.chunks.length, 1);
  assert.match(output.chunks[0], /"level":"warn"/);
});
