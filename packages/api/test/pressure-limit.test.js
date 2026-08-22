import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createPressureLimit } from '../src/pressure-limit.js';

function responseRecorder() {
  const emitter = new EventEmitter();
  const headers = new Map();
  let statusCode = 200;
  let body = null;
  return {
    headers,
    get statusCode() { return statusCode; },
    get body() { return body; },
    once: emitter.once.bind(emitter),
    emit: emitter.emit.bind(emitter),
    set(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };
}

test('pressure limiter can be explicitly disabled', () => {
  assert.equal(createPressureLimit({ enabled: false }), null);
});

test('pressure limiter sheds requests when heap pressure reaches threshold', () => {
  const limiter = createPressureLimit({
    maxConcurrent: 10,
    maxHeapPercent: 95,
    memoryUsage: () => ({ heapUsed: 96, heapTotal: 100 }),
  });
  const res = responseRecorder();
  let nextCalled = false;

  limiter({ id: 'req-memory' }, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers.get('retry-after'), '1');
  assert.equal(res.body.errors[0].code, 'SERVER_PRESSURE');
  assert.equal(res.body.errors[0].request_id, 'req-memory');
});

test('pressure limiter bounds concurrent requests and releases capacity on finish', () => {
  const limiter = createPressureLimit({
    maxConcurrent: 1,
    maxHeapPercent: 95,
    memoryUsage: () => ({ heapUsed: 10, heapTotal: 100 }),
  });

  const first = responseRecorder();
  let firstNext = false;
  limiter({ id: 'req-1' }, first, () => { firstNext = true; });
  assert.equal(firstNext, true);

  const second = responseRecorder();
  let secondNext = false;
  limiter({ id: 'req-2' }, second, () => { secondNext = true; });
  assert.equal(secondNext, false);
  assert.equal(second.statusCode, 503);

  first.emit('finish');

  const third = responseRecorder();
  let thirdNext = false;
  limiter({ id: 'req-3' }, third, () => { thirdNext = true; });
  assert.equal(thirdNext, true);
  third.emit('close');
});

test('pressure limiter validates thresholds', () => {
  assert.throws(() => createPressureLimit({ maxConcurrent: 0 }), /maxConcurrent/);
  assert.throws(() => createPressureLimit({ maxHeapPercent: 101 }), /cannot exceed 100/);
  assert.throws(() => createPressureLimit({ retryAfterSeconds: 0 }), /retryAfterSeconds/);
});
