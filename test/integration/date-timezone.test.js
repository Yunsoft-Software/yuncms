// Real MySQL timezone isolation for DATE columns and session token expiration
// Tracks: https://github.com/Yunsoft-Software/yuncms/issues/38
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  bootstrapDatabase,
  closeDatabasePool,
  CollectionsService,
  createDatabasePool,
  createSystemAccountability,
  FieldsService,
  ItemsService,
  loadConfig,
  RolesService,
  UsersService,
} from '@yunsoft/yuncms-core';

const ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';

const DIR = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(DIR, 'fixtures', 'date-timezone-worker.mjs');

function requireDisposableDatabase(config) {
  if (!DESTRUCTIVE) {
    throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required for integration suite');
  }
  const dbName = config.database?.database ?? '';
  if (!/(test|ci|dev)/i.test(dbName)) {
    throw new Error(`Integration DB name must contain test, ci or dev: ${dbName}`);
  }
}

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(-9);
}

function runWorker({ env = {}, args = [] }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [WORKER_PATH, ...args],
      {
        env: {
          ...process.env,
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 25_000,
        killSignal: 'SIGKILL',
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on('error', reject);
  });
}

test('MySQL timezone isolation for DATE columns and session token expiration', {
  skip: !ENABLED,
  timeout: 180_000,
}, async (t) => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);

  const pool = createDatabasePool(config.database);
  const system = createSystemAccountability();
  const runId = suffix();

  const collection = `it_tz_dates_${runId}`;
  const collections = new CollectionsService({ database: pool, accountability: system });
  const fields = new FieldsService({ database: pool, accountability: system });
  const roles = new RolesService({ database: pool, accountability: system });
  const users = new UsersService({ database: pool, accountability: system });

  let collectionCreated = false;
  let roleIdCreated = null;
  let userIdCreated = null;
  let itemStandard;
  let itemLeap;

  try {
    await bootstrapDatabase(pool);

    // Setup unique collection, date and datetime fields
    await collections.createOne({ collection });
    collectionCreated = true;

    await fields.createOne(collection, { field: 'record_date', type: 'date', required: false });
    await fields.createOne(collection, { field: 'event_datetime', type: 'datetime', required: false });

    const items = new ItemsService(collection, { database: pool, accountability: system });
    itemStandard = await items.createOne({ record_date: '2026-10-10' });
    itemLeap = await items.createOne({ record_date: '2024-02-29' });
    const itemNullDate = await items.createOne({ record_date: null });
    const itemOffsetDatetime = await items.createOne({ event_datetime: '2026-10-10T15:30:00+03:00' });

    // Setup unique role and user
    const role = await roles.createOne({
      name: `Timezone Test Role ${runId}`,
      description: 'Temporary role for timezone session audit',
    });
    roleIdCreated = role.id;

    const user = await users.createOne({
      email: `tz-user-${runId}@example.test`,
      password: `Tz-Pass-${runId}!`,
      role: roleIdCreated,
      status: 'active',
      emailVerified: true,
    });
    userIdCreated = user.id;

    // 1-6) 3 Node Timezones x 2 Date Cases = 6 separate subtests in loop
    // DB session time_zone is fixed at +00:00 for DATE tests
    const timezones = ['UTC', 'Europe/Istanbul', 'America/New_York'];
    const dateCases = [
      { label: 'standard (2026-10-10)', id: itemStandard.id, expected: '2026-10-10' },
      { label: 'leap day (2024-02-29)', id: itemLeap.id, expected: '2024-02-29' },
    ];

    for (const tz of timezones) {
      for (const { label, id, expected } of dateCases) {
        await t.test(`DATE ${label} under Node TZ=${tz} (session time_zone +00:00)`, async () => {
          const res = await runWorker({
            env: { TZ: tz },
            args: [
              '--mode=date',
              `--collection=${collection}`,
              `--id=${id}`,
              '--session-tz=+00:00',
            ],
          });
          assert.equal(
            res.code,
            0,
            `Worker exited with code ${res.code} (signal: ${res.signal}, stderr: ${res.stderr || 'none'})`,
          );
          const payload = JSON.parse(res.stdout);
          assert.equal(payload.ok, true);
          assert.equal(payload.id, id);
          assert.equal(payload.value, expected);
        });
      }
    }

    // 7) NULL DATE preserves null across Node timezones
    for (const tz of timezones) {
      await t.test(`NULL DATE under Node TZ=${tz} (session time_zone +00:00)`, async () => {
        const res = await runWorker({
          env: { TZ: tz },
          args: [
            '--mode=date',
            `--collection=${collection}`,
            `--id=${itemNullDate.id}`,
            '--field=record_date',
            '--session-tz=+00:00',
          ],
        });
        assert.equal(
          res.code,
          0,
          `Worker exited with code ${res.code} (signal: ${res.signal}, stderr: ${res.stderr || 'none'})`,
        );
        const payload = JSON.parse(res.stdout);
        assert.equal(payload.ok, true);
        assert.equal(payload.id, itemNullDate.id);
        assert.equal(payload.value, null);
      });
    }

    // 8) Offset DATETIME UTC round trip preserved across Node timezones
    for (const tz of timezones) {
      await t.test(`Offset DATETIME round-trip under Node TZ=${tz} (session time_zone +00:00)`, async () => {
        const res = await runWorker({
          env: { TZ: tz },
          args: [
            '--mode=date',
            `--collection=${collection}`,
            `--id=${itemOffsetDatetime.id}`,
            '--field=event_datetime',
            '--session-tz=+00:00',
          ],
        });
        assert.equal(
          res.code,
          0,
          `Worker exited with code ${res.code} (signal: ${res.signal}, stderr: ${res.stderr || 'none'})`,
        );
        const payload = JSON.parse(res.stdout);
        assert.equal(payload.ok, true);
        assert.equal(payload.id, itemOffsetDatetime.id);
        assert.equal(payload.value, '2026-10-10T12:30:00.000Z');
      });
    }

    // 9) Session authentication under Node TZ=UTC and DB session time_zone=+00:00
    await t.test('Session token authenticated immediately under Node UTC and session time_zone +00:00', async () => {
      const res = await runWorker({
        env: { TZ: 'UTC' },
        args: [
          '--mode=session',
          `--user-id=${userIdCreated}`,
          '--session-tz=+00:00',
        ],
      });
      assert.equal(
        res.code,
        0,
        `Worker exited with code ${res.code} (signal: ${res.signal}, stderr: ${res.stderr || 'none'})`,
      );
      const payload = JSON.parse(res.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.authenticated, true);
      assert.equal(payload.user, userIdCreated);
    });

    // 10) Session authentication under Node TZ=UTC and DB session time_zone=+03:00 (#38 boundary)
    await t.test('Session token authenticated immediately under Node UTC and session time_zone +03:00', async () => {
      const res = await runWorker({
        env: { TZ: 'UTC' },
        args: [
          '--mode=session',
          `--user-id=${userIdCreated}`,
          '--session-tz=+03:00',
        ],
      });
      assert.equal(
        res.code,
        0,
        `Worker exited with code ${res.code} (signal: ${res.signal}, stderr: ${res.stderr || 'none'})`,
      );
      const payload = JSON.parse(res.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.authenticated, true);
      assert.equal(payload.user, userIdCreated);
    });

    // 11) Session refresh rotation succeeds under DB session time_zone +03:00
    await t.test('Session token refresh rotation succeeds under session time_zone +03:00', async () => {
      const res = await runWorker({
        env: { TZ: 'UTC' },
        args: [
          '--mode=session',
          '--action=refresh',
          `--user-id=${userIdCreated}`,
          '--session-tz=+03:00',
        ],
      });
      assert.equal(
        res.code,
        0,
        `Worker exited with code ${res.code} (signal: ${res.signal}, stderr: ${res.stderr || 'none'})`,
      );
      const payload = JSON.parse(res.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.success, true);
      assert.equal(payload.user, userIdCreated);
    });

    // 12) Session replay attack rejected under DB session time_zone +03:00
    await t.test('Session token replay attack rejected under session time_zone +03:00', async () => {
      const res = await runWorker({
        env: { TZ: 'UTC' },
        args: [
          '--mode=session',
          '--action=replay',
          `--user-id=${userIdCreated}`,
          '--session-tz=+03:00',
        ],
      });
      assert.equal(
        res.code,
        0,
        `Worker exited with code ${res.code} (signal: ${res.signal}, stderr: ${res.stderr || 'none'})`,
      );
      const payload = JSON.parse(res.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.success, true);
      assert.equal(payload.errorCode, 'INVALID_CREDENTIALS');
    });

    // 13) Expired session token rejected under DB session time_zone +03:00
    await t.test('Expired session token rejected under session time_zone +03:00', async () => {
      const res = await runWorker({
        env: { TZ: 'UTC' },
        args: [
          '--mode=session',
          '--action=expired',
          `--user-id=${userIdCreated}`,
          '--session-tz=+03:00',
        ],
      });
      assert.equal(
        res.code,
        0,
        `Worker exited with code ${res.code} (signal: ${res.signal}, stderr: ${res.stderr || 'none'})`,
      );
      const payload = JSON.parse(res.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.success, true);
      assert.equal(payload.errorCode, 'INVALID_CREDENTIALS');
    });
  } finally {
    // Native cleanup for created resources; attempt each step and close pool
    const cleanupErrors = [];

    if (collectionCreated) {
      try {
        await collections.deleteOne(collection, { destructive: true });
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    if (userIdCreated) {
      try {
        await users.deleteOne(userIdCreated);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    if (roleIdCreated) {
      try {
        await roles.deleteOne(roleIdCreated);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    try {
      await closeDatabasePool(pool);
    } catch (err) {
      cleanupErrors.push(err);
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, `Integration cleanup failed with ${cleanupErrors.length} error(s)`);
    }
  }
});
