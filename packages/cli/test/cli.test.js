import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';

import { assertSupportedNode, runCli } from '../src/cli.js';
import { serializeEnv } from '../src/env-file.js';
import { collectEnvironment, offerOptionalPremiumSubscription, parseOptInResponse } from '../src/init-command.js';
import { runStartCommand } from '../src/start-command.js';

test('node guard accepts only node 24 baseline', () => {
  assert.doesNotThrow(() => assertSupportedNode('24.8.0'));
  assert.throws(
    () => assertSupportedNode('22.20.0'),
    (error) => error.code === 'UNSUPPORTED_NODE_VERSION',
  );
});

test('init writes same-origin port 3008 defaults', async () => {
  const answers = ['127.0.0.1', '3306', 'yuncms', 'yuncms', 'false'];
  const prompts = {
    async line() { return answers.shift(); },
    async secret() { return 'secret'; },
  };
  const env = await collectEnvironment(prompts);
  assert.equal(env.PORT, '3008');
  assert.equal(env.STUDIO_ORIGIN, 'http://localhost:3008');
  assert.equal(env.AUTH_PUBLIC_URL, 'http://localhost:3008');
  assert.equal(Object.values(env).includes('8055'), false);
});

test('help advertises setup, runtime and managed upgrade commands', async () => {
  const lines = [];
  await runCli(['help'], { output: { log: (line) => lines.push(line) }, env: {} });
  const help = lines.join('\n');

  assert.match(help, /yuncms init/);
  assert.match(help, /yuncms bootstrap/);
  assert.match(help, /yuncms start/);
  assert.match(help, /yuncms backup/);
  assert.match(help, /yuncms restore/);
  assert.match(help, /yuncms update/);
  assert.match(help, /--dry-run/);
});

test('start command receives current environment and working directory', async () => {
  const calls = [];
  const result = await runCli(['start'], {
    output: { log() {} },
    env: { DB_HOST: 'db.internal' },
    cwd: '/srv/yuncms-project',
    startCommand: async (options) => {
      calls.push(options);
      return { code: 0 };
    },
  });

  assert.deepEqual(result, { code: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, '/srv/yuncms-project');
  assert.equal(calls[0].env.DB_HOST, 'db.internal');
});

test('start command forwards shutdown signals and waits for a clean child exit', async () => {
  const signalSource = new EventEmitter();
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal) => {
    assert.equal(signal, 'SIGTERM');
    child.exitCode = 0;
    queueMicrotask(() => child.emit('exit', 0, null));
    return true;
  };
  let spawnOptions;

  const resultPromise = runStartCommand({
    env: { DB_HOST: 'db.internal' },
    cwd: '/srv/yuncms-project',
    output: { log() {} },
    signalSource,
    spawnProcess(_runtime, _args, options) {
      spawnOptions = options;
      queueMicrotask(() => signalSource.emit('SIGTERM'));
      return child;
    },
  });

  assert.deepEqual(await resultPromise, { code: 0, signal: null });
  assert.equal(spawnOptions.cwd, '/srv/yuncms-project');
  assert.equal(spawnOptions.detached, process.platform !== 'win32');
  assert.equal(signalSource.listenerCount('SIGTERM'), 0);
  assert.equal(signalSource.listenerCount('SIGINT'), 0);
});

test('start command treats an explicitly forwarded shutdown signal as a clean exit', async () => {
  const signalSource = new EventEmitter();
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal) => {
    assert.equal(signal, 'SIGINT');
    child.signalCode = signal;
    queueMicrotask(() => child.emit('exit', null, signal));
    return true;
  };

  const resultPromise = runStartCommand({
    output: { log() {} },
    signalSource,
    spawnProcess() {
      queueMicrotask(() => signalSource.emit('SIGINT'));
      return child;
    },
  });

  assert.deepEqual(await resultPromise, { code: 0, signal: 'SIGINT' });
  assert.equal(signalSource.listenerCount('SIGTERM'), 0);
  assert.equal(signalSource.listenerCount('SIGINT'), 0);
});

test('updater attached runtime keeps the API in the probe process group', async () => {
  const child = new EventEmitter();
  let options;
  await runStartCommand({
    env: { YUNCMS_CLI_ATTACHED_RUNTIME: '1' },
    output: { log() {} }, signalSource: new EventEmitter(),
    spawnProcess(_runtime, _args, spawnOptions) {
      options = spawnOptions;
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    },
  });
  assert.equal(options.detached, false);
});

test('env serialization quotes values and rejects multiline secrets', () => {
  const serialized = serializeEnv({
    DB_HOST: '127.0.0.1',
    DB_PASSWORD: 'space # quote " slash \\',
  });

  assert.match(serialized, /DB_HOST="127\.0\.0\.1"/);
  assert.match(serialized, /DB_PASSWORD="space # quote \\" slash \\\\"/);
  assert.throws(() => serializeEnv({ DB_PASSWORD: 'line1\nline2' }), /cannot contain newlines/);
});

test('unknown commands fail closed', async () => {
  await assert.rejects(
    runCli(['graphql'], { output: { log() {} }, env: {} }),
    (error) => error.code === 'UNKNOWN_CLI_COMMAND',
  );
});

test('optional 3-month Premium offer in init skips by default, never phones home and only displays an explicitly configured safe URL on opt-in', async () => {
  for (const yes of ['y', 'Y', 'yes', 'YES', 'e', 'evet']) assert.equal(parseOptInResponse(yes), true);
  for (const no of ['', 'n', 'no', 'h', 'hayir', 'maybe', null, undefined]) assert.equal(parseOptInResponse(no), false);

  // Unconfigured default: zero prompts, zero output, no hardcoded URL invented
  let prompted = false;
  const unconfiguredLogs = [];
  const unconfigured = await offerOptionalPremiumSubscription({
    env: {},
    prompts: { async line() { prompted = true; return 'y'; } },
    output: { log(msg) { unconfiguredLogs.push(msg); } },
    isTTY: true,
  });
  assert.deepEqual(unconfigured, { configured: false, optedIn: false, url: null });
  assert.equal(prompted, false);
  assert.deepEqual(unconfiguredLogs, []);

  // Safe local loopback target probe: verify ZERO outbound network requests on skip, CI and opt-in
  const hits = [];
  const server = createServer((req, res) => {
    hits.push({ method: req.method, url: req.url });
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const localOfferUrl = `http://127.0.0.1:${server.address().port}/premium-offer`;

  try {
    // CI/non-TTY skips silently without prompting
    const ciResult = await offerOptionalPremiumSubscription({
      env: { CI: 'true', YUNCMS_PREMIUM_OFFER_URL: localOfferUrl },
      prompts: { async line() { throw new Error('must not prompt in CI'); } },
      output: { log() {} },
      isTTY: true,
    });
    assert.deepEqual(ciResult, { configured: true, optedIn: false, url: null });

    // Interactive skip (default n)
    const skipLogs = [];
    const skipResult = await offerOptionalPremiumSubscription({
      env: { YUNCMS_PREMIUM_OFFER_URL: localOfferUrl },
      prompts: { async line(_msg, opts) { assert.equal(opts.defaultValue, 'n'); return opts.defaultValue; } },
      output: { log(msg) { skipLogs.push(msg); } },
      isTTY: true,
    });
    assert.deepEqual(skipResult, { configured: true, optedIn: false, url: null });
    assert.deepEqual(skipLogs, []);

    // Interactive explicit opt-in displays exact configured URL without transmitting email/key/install info
    const optInLogs = [];
    const optInResult = await offerOptionalPremiumSubscription({
      env: { YUNCMS_PREMIUM_OFFER_URL: localOfferUrl, AUTH_PUBLIC_URL: 'https://tenant.example.test' },
      prompts: { async line() { return 'y'; } },
      output: { log(msg) { optInLogs.push(msg); } },
      isTTY: true,
    });
    assert.deepEqual(optInResult, { configured: true, optedIn: true, url: localOfferUrl });
    const printed = optInLogs.join('\n');
    assert.ok(printed.includes(localOfferUrl));
    assert.doesNotMatch(printed, /tenant\.example\.test/);
    assert.match(printed, /did not send your email, license key or installation details/i);
    assert.equal(hits.length, 0);

    // Unsafe URL fails closed
    await assert.rejects(
      offerOptionalPremiumSubscription({
        env: { YUNCMS_PREMIUM_OFFER_URL: 'http://yunsoft.com/insecure' },
        prompts: { async line() { return 'y'; } },
        output: { log() {} },
        isTTY: true,
      }),
      { code: 'INVALID_CONFIGURATION' },
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
