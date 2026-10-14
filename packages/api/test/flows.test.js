import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { createFlowsRouter } from '../src/routes/flows.js';
import { apiErrorHandler } from '../src/error-response.js';
import { createPublicAccountability } from '@yunsoft/yuncms-core';
import { FlowRuntime } from '../src/flows/runtime.js';

test('Flow API routes preserve verified request options and ignore caller-supplied authority', async t => {
  const calls = [], actor = createPublicAccountability(), database = {}, mailer = {};
  class FlowsService {
    constructor(options) { assert.equal(options.accountability, actor); assert.equal(options.database, database); assert.equal(options.requestId, 'verified-request'); assert.equal(options.mailer, mailer); }
    async runWebhook(id, input, method) { calls.push({ id, input, method }); return { status: 'succeeded', output: input.body }; }
    async runManual(id, input) { calls.push({ id, input }); return { status: 'succeeded' }; }
    async deleteOne(id, revision) { calls.push({ id, revision }); }
  }
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.id = 'verified-request'; req.accountability = actor; req.context = { database, services: { FlowsService } }; next(); });
  app.use('/flows', createFlowsRouter({ mailer })); app.use(apiErrorHandler({ error() {} }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); }); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/flows/trigger/example`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountability: { admin: true }, value: 1 }) })).status, 200);
  assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].input.body.accountability.admin, true); // untrusted payload stays data; service authority came only from context.
  assert.equal((await fetch(`${base}/flows/example/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 200);
  assert.equal((await fetch(`${base}/flows/example?revision=2`, { method: 'DELETE' })).status, 204); assert.equal(calls.at(-1).revision, 2);
  await fetch(`${base}/flows/example?revision[]=2`, { method: 'DELETE' }); assert.equal(calls.at(-1).revision, null);
});

test('a slow background flow does not block scheduled dispatch and shutdown drains both workers', async () => {
  let finishJob, jobs = 0, schedules = 0;
  const blocked = new Promise(resolve => { finishJob = resolve; });
  const runtime = new FlowRuntime({});
  runtime.service = () => ({
    async dispatchable() { schedules++; return []; },
    async runNext() { jobs++; await blocked; },
  });
  runtime.pump(new Date('2026-10-15T00:00:00Z'));
  await runtime.scheduleRunning;
  runtime.pump(new Date('2026-10-15T00:00:01Z'));
  await runtime.scheduleRunning;
  assert.equal(schedules, 2); assert.equal(jobs, 1);
  let stopped = false;
  const stopping = runtime.stop().then(() => { stopped = true; });
  await Promise.resolve(); assert.equal(stopped, false);
  finishJob(); await stopping; assert.equal(stopped, true);
  runtime.pump(new Date('2026-10-15T00:00:02Z')); assert.equal(jobs, 1);
});
