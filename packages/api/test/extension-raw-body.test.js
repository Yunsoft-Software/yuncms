import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import express from 'express';
import { loadConfig } from '@yunsoft/yuncms-core';
import { ExtensionError } from '@yunsoft/yuncms-extensions-sdk';
import { createApp } from '../src/app.js';
import { validateExtensionManifest } from '../src/extensions/manifest.js';

test('rawBody manifest is opt-in and restricted to endpoint booleans', () => {
  const pkg = { yuncms: { type: 'endpoint', id: 'signed', entry: './index.js', rawBody: true } };
  assert.equal(validateExtensionManifest(pkg, '/tmp').rawBody, true);
  for (const change of [{ rawBody: 'true' }, { type: 'hook' }]) {
    assert.throws(() => validateExtensionManifest({ yuncms: { ...pkg.yuncms, ...change } }, '/tmp'), { code: 'INVALID_EXTENSION_MANIFEST' });
  }
});

test('endpoint receives bounded original JSON bytes, parsed body and native accountability', async t => {
  const signed = express.Router(), ordinary = express.Router();
  const secret = 'local-regression-fixture';
  const mac = data => createHmac('sha256', secret).update(data).digest();
  signed.post('/', (req, res) => {
    assert.ok(Buffer.isBuffer(req.rawBody));
    assert.equal(req.accountability.public, true);
    const received = Buffer.from(req.get('x-signature') ?? '', 'hex');
    const expected = mac(req.rawBody);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new ExtensionError('BAD_SIGNATURE', 'Invalid signature', { status: 401 });
    res.json({ raw: req.rawBody.toString(), parsed: req.body });
  });
  ordinary.post('/', (req, res) => res.json({ hasRaw: req.rawBody !== undefined, parsed: req.body }));
  const app = createApp({ pool: { async query() { return [[], []]; } }, config: loadConfig({ API_RATE_LIMIT_ENABLED: 'false' }), logger: { error() {} }, endpointExtensions: [
    { id: 'signed', router: signed, manifest: { rawBody: true } }, { id: 'ordinary', router: ordinary },
  ] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const raw = '{\n  "b": 2, "a" : "ü"\n}';
  const request = (path, body, extra = {}) => fetch(`${base}/extensions/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': mac(body).toString('hex'), ...extra }, body });
  const response = await request('signed', raw);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { raw, parsed: { b: 2, a: 'ü' } });
  assert.equal((await request('signed', raw, { 'x-signature': mac(JSON.stringify(JSON.parse(raw))).toString('hex') })).status, 401);
  const normal = await request('ordinary', raw);
  assert.deepEqual(await normal.json(), { hasRaw: false, parsed: { b: 2, a: 'ü' } });
  assert.equal((await request('signed', '{bad')).status, 400);
  assert.equal((await request('signed', JSON.stringify({ text: 'x'.repeat(1024 * 1024) }))).status, 413);
  assert.equal((await request('signed', gzipSync(raw), { 'content-encoding': 'gzip' })).status, 415);
  assert.equal((await request('signed', raw, { authorization: 'Bearer invalid-token' })).status, 401);
});
