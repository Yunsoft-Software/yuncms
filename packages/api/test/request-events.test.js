import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequestEvents } from '../src/app.js';

function fakeResponse() {
  const handlers = new Map();
  return {
    statusCode: 200,
    once(name, handler) { handlers.set(name, handler); },
    finish() { handlers.get('finish')?.(); },
  };
}

test('request lifecycle events expose metadata only', async () => {
  const events = [];
  const emitter = { async action(name, payload) { events.push({ name, payload }); } };
  const middleware = createRequestEvents(emitter);
  const req = {
    id: 'req-1', method: 'GET', path: '/items/articles', ip: '127.0.0.1',
    accountability: { user: 'u1', role: 'r1', admin: false },
    headers: { authorization: 'Bearer secret' }, body: { password: 'secret' },
  };
  const res = fakeResponse();
  middleware(req, res, () => {});
  res.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events.map((entry) => entry.name), ['request.received', 'request.completed']);
  assert.equal(JSON.stringify(events).includes('Bearer secret'), false);
  assert.equal(JSON.stringify(events).includes('password'), false);
});
