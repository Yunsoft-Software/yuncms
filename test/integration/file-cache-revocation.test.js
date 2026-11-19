import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createFileCacheFixture } from '../helpers/file-cache-fixture.mjs';

function wireRequest(origin, path, token, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(origin + path, { method, agent: false, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}

function assertPolicy(r, expected) {
  assert.equal(r.headers['cache-control'], expected);
  const vary = (r.headers.vary ?? '').toLowerCase().split(/,\s*/);
  assert.ok(vary.includes('authorization')); assert.ok(vary.includes('cookie'));
}

test('real MySQL/HTTP file cache policy covers GET/HEAD/206/304/416, revocation, sessions and aliases', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 120000,
}, async t => {
  const f = await createFileCacheFixture();
  const paths = ['/files/' + f.file.id + '/content', '/assets/' + f.file.id];
  const validators = new Map();
  try {
    await f.setReaderGrant(true);
    for (const path of paths) {
      await t.test('authorized response variants: ' + path.split('/')[1], async () => {
        const r = await wireRequest(f.origin, path, f.tokens.reader, { headers: { origin: f.studioOrigin } });
        assert.equal(r.status, 200); assert.deepEqual(r.bytes, f.bytes); assertPolicy(r, 'private, no-store');
        assert.equal(r.headers['access-control-allow-origin'], f.studioOrigin);
        assert.ok(r.headers.vary.toLowerCase().split(/,\s*/).includes('origin'));
        validators.set(path, r.headers);
        const variants = [
          [{ method: 'HEAD' }, 200, Buffer.alloc(0)],
          [{ headers: { range: 'bytes=0-31' } }, 206, f.bytes.subarray(0, 32)],
          [{ headers: { range: 'bytes=999999999-' } }, 416, Buffer.alloc(0)],
          [{ headers: { 'if-none-match': r.headers.etag } }, 304, Buffer.alloc(0)],
          [{ method: 'HEAD', headers: { 'if-none-match': r.headers.etag } }, 304, Buffer.alloc(0)],
          [{ headers: { 'if-modified-since': r.headers['last-modified'] } }, 304, Buffer.alloc(0)],
          [{ headers: { range: 'bytes=0-31', 'if-range': r.headers.etag } }, 206, f.bytes.subarray(0, 32)],
        ];
        for (const [options, status, bytes] of variants) {
          const response = await wireRequest(f.origin, path, f.tokens.reader, options);
          assert.equal(response.status, status); assert.deepEqual(response.bytes, bytes); assertPolicy(response, 'private, no-store');
        }
      });
    }
    const readCommittedGrant = async () => {
      const responses = await Promise.all(paths.map(path => wireRequest(f.origin, path, f.tokens.reader)));
      for (const response of responses) {
        assert.equal(response.status, 200);
        assert.deepEqual(response.bytes, f.bytes);
      }
    };
    await f.withPendingReaderGrant(false, { commit: false }, readCommittedGrant);
    await readCommittedGrant();
    await f.withPendingReaderGrant(false, { commit: true }, readCommittedGrant);
    for (const path of paths) {
      const invalid = await wireRequest(f.origin, path, 'invalid-native-token');
      assert.equal(invalid.status, 401); assertPolicy(invalid, 'private, no-store');
      assert.notEqual(invalid.headers.etag, validators.get(path).etag);
    }
    const fresh = await f.login('reader'); assert.notEqual(fresh, f.tokens.reader);
    for (const restart of [false, true]) {
      if (restart) { const { previousPid, currentPid } = await f.restart(); assert.notEqual(previousPid, currentPid); }
      await t.test(restart ? 'native restart retains denials and original bytes' : 'revoked, fresh and never-authorized actors are denied', async () => {
        for (const path of paths) {
          const previous = validators.get(path);
          for (const token of [f.tokens.reader, fresh, f.tokens.other]) {
            for (const options of [{}, { method: 'HEAD' }, { headers: { range: 'bytes=0-31' } },
              { headers: { 'if-none-match': previous.etag } }, { method: 'HEAD', headers: { 'if-none-match': previous.etag } },
              { headers: { 'if-modified-since': previous['last-modified'] } },
              { headers: { range: 'bytes=0-31', 'if-range': previous.etag } }]) {
              const r = await wireRequest(f.origin, path, token, options);
              assert.equal(r.status, 404); assertPolicy(r, 'private, no-store');
              assert.notEqual(r.headers.etag, previous.etag); assert.equal(r.headers['last-modified'], undefined);
              assert.equal(r.headers['content-range'], undefined); assert.equal(r.bytes.includes(f.bytes), false);
            }
          }
          const owner = await wireRequest(f.origin, path, f.tokens.owner);
          assert.equal(owner.status, 200); assert.deepEqual(owner.bytes, f.bytes);
        }
        const neighbor = await wireRequest(f.origin, '/files/' + f.neighbor.id + '/content', f.tokens.owner);
        assert.equal(neighbor.status, 200); assert.deepEqual(neighbor.bytes, f.neighborBytes);
        const [[row]] = await f.database.query('SELECT uploaded_by FROM yuncms_files WHERE id = ?', [f.file.id]);
        assert.equal(row.uploaded_by, f.actors.owner.id);
      });
    }
    await t.test('intentional Public role access permits stored revalidation, then denies revoked access', async () => {
      const grant = await f.publicGrant();
      for (const path of ['/files/' + f.neighbor.id + '/content', '/assets/' + f.neighbor.id]) {
        const r = await wireRequest(f.origin, path);
        assert.equal(r.status, 200); assert.deepEqual(r.bytes, f.neighborBytes); assertPolicy(r, 'public, no-cache, must-revalidate');
        for (const options of [{ method: 'HEAD' }, { headers: { 'if-none-match': r.headers.etag } }, { headers: { range: 'bytes=0-3' } }]) {
          const response = await wireRequest(f.origin, path, null, options);
          assert.equal(response.status, options.method ? 200 : options.headers.range ? 206 : 304);
          assertPolicy(response, 'public, no-cache, must-revalidate');
        }
        assert.equal((await wireRequest(f.origin, path, f.tokens.other)).status, 404);
      }
      assert.equal((await f.request('/permissions/' + grant.id, { method: 'DELETE', token: f.tokens.owner })).status, 204);
      const denied = await wireRequest(f.origin, '/files/' + f.neighbor.id + '/content');
      assert.equal(denied.status, 403); assertPolicy(denied, 'private, no-store');
    });
  } finally { await f.close(); }
});
