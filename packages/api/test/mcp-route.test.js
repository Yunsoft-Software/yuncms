import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

import express from 'express';

import { apiErrorHandler } from '../src/error-response.js';
import { createMcpRouter } from '../src/mcp.js';

function request(server, path, { method = 'GET', admin = true, body = null, host = null } = {}) {
  const payload = body == null ? null : JSON.stringify(body);
  const headers = {
    'x-test-admin': admin ? '1' : '0',
    ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
    ...(host == null ? {} : { host }),
  };
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port: server.address().port,
      path,
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
      });
    });
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('MCP administrator routes persist settings and runtime guards read changes without restart', async () => {
  let settings = {
    enabled: false,
    writes_enabled: false,
    require_authentication: true,
    allowed_origins: [],
    allowed_hosts: [],
    max_items: 100,
    max_result_bytes: 1_000_000,
    updated_at: null,
  };
  const settingsStore = {
    async readAdmin() { return settings; },
    async readRuntime() {
      return {
        enabled: settings.enabled,
        writesEnabled: settings.writes_enabled,
        requireAuthentication: settings.require_authentication,
        allowedOrigins: settings.allowed_origins,
        allowedHosts: settings.allowed_hosts,
        maxItems: settings.max_items,
        maxResultBytes: settings.max_result_bytes,
      };
    },
    async update(patch) {
      settings = { ...settings, ...patch, updated_at: '2026-08-25T00:00:00.000Z' };
      return settings;
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const admin = req.get('x-test-admin') === '1';
    req.id = 'route-test';
    req.authMethod = 'session';
    req.accountability = { user: 'user-1', admin, system: false };
    next();
  });
  app.use('/mcp', createMcpRouter({ settingsStore, logger: { error() {} } }));
  app.use(apiErrorHandler({ error() {} }));
  const server = await listen(app);

  try {
    const forbidden = await request(server, '/mcp/settings', { admin: false });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.errors[0].code, 'FORBIDDEN');

    const disabled = await request(server, '/mcp', { method: 'POST' });
    assert.equal(disabled.status, 404);
    assert.equal(disabled.body.errors[0].code, 'MCP_DISABLED');

    const updated = await request(server, '/mcp/settings', {
      method: 'PATCH',
      body: { enabled: true, allowed_hosts: ['api.example.test'] },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.enabled, true);

    const guarded = await request(server, '/mcp', { method: 'POST', host: 'wrong.example.test' });
    assert.equal(guarded.status, 403);
    assert.equal(guarded.body.errors[0].code, 'MCP_HOST_FORBIDDEN');
  } finally {
    await close(server);
  }
});
