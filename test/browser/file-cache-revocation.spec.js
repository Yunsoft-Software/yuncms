import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createFileCacheFixture } from '../helpers/file-cache-fixture.mjs';

test('default browser cache rechecks private grants across actors, fresh sessions, aliases and native restart', async ({ page, context, browserName }, testInfo) => {
  const f = await createFileCacheFixture();
  const events = [];
  let cdp;
  try {
    if (browserName === 'chromium') {
      cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
      cdp.on('Network.responseReceived', ({ response }) => {
        if (response.url.includes(f.file.id)) events.push({ status: response.status,
          fromDiskCache: response.fromDiskCache === true, fromServiceWorker: response.fromServiceWorker === true });
      });
    }
    await page.goto(f.origin + '/health');
    const paths = ['/files/' + f.file.id + '/content', '/assets/' + f.file.id];
    const read = (path, token, extra = {}) => page.evaluate(async ({ path, token, extra }) => {
      // Deliberately use the ordinary browser cache mode, no reload, nonce,
      // request interception, routing, or cache-busting query string.
      const r = await fetch(path, { ...extra, headers: { authorization: 'Bearer ' + token, ...extra.headers } });
      const bytes = new Uint8Array(await r.arrayBuffer());
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      return { status: r.status, hash, size: bytes.length, etag: r.headers.get('etag'),
        modified: r.headers.get('last-modified'), cache: r.headers.get('cache-control'), vary: r.headers.get('vary') };
    }, { path, token, extra });
    const hash = createHash('sha256').update(f.bytes).digest('hex');
    for (const path of paths) expect((await f.request(path, { token: f.tokens.other })).status).toBe(404);
    await f.setReaderGrant(true);
    const validators = new Map();
    for (const path of paths) {
      const initial = await read(path, f.tokens.reader);
      expect(initial.status).toBe(200); expect(initial.hash).toBe(hash);
      validators.set(path, initial);
    }
    await f.withPendingReaderGrant(false, { commit: true }, async () => {
      const responses = await Promise.all(paths.map(path => read(path, f.tokens.reader)));
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.hash).toBe(hash);
      }
    });
    const fresh = await f.login('reader'); expect(fresh).not.toBe(f.tokens.reader);
    for (const token of [f.tokens.reader, fresh, f.tokens.other]) {
      for (const path of paths) {
        const denied = await read(path, token);
        expect(denied.status, JSON.stringify({ denied, events })).toBe(404);
        expect(denied.hash).not.toBe(hash); expect(denied.etag).not.toBe(validators.get(path).etag);
        expect(denied.cache).toBe('private, no-store');
      }
    }
    for (const path of paths) {
      const previous = validators.get(path);
      for (const extra of [{ method: 'HEAD' }, { headers: { range: 'bytes=0-31' } },
        { headers: { 'if-none-match': previous.etag } }, { headers: { 'if-modified-since': previous.modified } }]) {
        expect((await read(path, fresh, extra)).status).toBe(404);
      }
    }
    const { previousPid, currentPid } = await f.restart(); expect(currentPid).not.toBe(previousPid);
    for (const path of paths) {
      expect((await read(path, fresh)).status).toBe(404);
      const owner = await read(path, f.tokens.owner); expect(owner.status).toBe(200); expect(owner.hash).toBe(hash);
      expect(owner.cache).toBe('private, no-store');
      expect((await read(path, f.tokens.other)).status).toBe(404);
    }
    const neighbor = await f.request('/files/' + f.neighbor.id + '/content', { token: f.tokens.owner });
    expect(neighbor.status).toBe(200); expect(neighbor.bytes.equals(f.neighborBytes)).toBe(true);
    if (cdp) { expect(events.length).toBeGreaterThan(10); expect(events.every(e => !e.fromDiskCache && !e.fromServiceWorker)).toBe(true); }
  } finally {
    await testInfo.attach('sanitized-file-cache-network', { body: JSON.stringify(events), contentType: 'application/json' });
    await cdp?.detach(); await f.close();
  }
});

test('Public file caching revalidates an intentional grant and cannot cross into another identity or survive revocation', async ({ page }) => {
  const f = await createFileCacheFixture();
  try {
    const grant = await f.publicGrant();
    await page.goto(f.origin + '/health');
    const read = (path, token = null) => page.evaluate(async ({ path, token }) => {
      const r = await fetch(path, { headers: token ? { authorization: 'Bearer ' + token } : {} });
      return { status: r.status, text: await r.text(), cache: r.headers.get('cache-control') };
    }, { path, token });
    const paths = ['/files/' + f.neighbor.id + '/content', '/assets/' + f.neighbor.id];
    for (const path of paths) {
      for (let pass = 0; pass < 2; pass++) {
        const publicFile = await read(path);
        expect(publicFile.status).toBe(200); expect(publicFile.text).toBe(f.neighborBytes.toString());
        expect(publicFile.cache).toBe('public, no-cache, must-revalidate');
      }
      expect((await read(path, f.tokens.other)).status).toBe(404);
    }
    expect((await f.request('/permissions/' + grant.id, { token: f.tokens.owner, method: 'DELETE' })).status).toBe(204);
    const [rows] = await f.database.query('SELECT id FROM yuncms_permissions WHERE id = ?', [grant.id]); expect(rows).toHaveLength(0);
    for (const restart of [false, true]) {
      if (restart) { const { previousPid, currentPid } = await f.restart(); expect(currentPid).not.toBe(previousPid); }
      for (const path of paths) {
        const denied = await read(path);
        expect(denied.status).toBe(403); expect(denied.cache).toBe('private, no-store');
        expect(denied.text).not.toBe(f.neighborBytes.toString());
      }
    }
  } finally { await f.close(); }
});
