import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  assertTestFilesExist,
  evaluateStrictSuiteResult,
  formatTestSummary,
  isStrictVerificationMode,
  parseTestSummary,
  validateStrictProfile,
} from '../../../scripts/verification-profile.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');

const VALID_STRICT_ENV = {
  YUNCMS_TEST_MYSQL: '1',
  YUNCMS_TEST_REDIS: '1',
  YUNCMS_TEST_MIGRATION: '1',
  YUNCMS_TEST_UPGRADE: '1',
  YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE: '1',
  YUNCMS_TEST_DOCKER: '1',
  YUNCMS_TEST_REDIS_URL: 'redis://127.0.0.1:6379/1',
  DB_DATABASE: 'yuncms_test',
  YUNCMS_MIGRATION_TEST_DB_DATABASE: 'yuncms_migration_test',
  YUNCMS_UPGRADE_TEST_DB_DATABASE: 'yuncms_upgrade_test',
};

test('validateStrictProfile accepts valid configuration with dedicated disposable databases and docker', () => {
  const result = validateStrictProfile(VALID_STRICT_ENV, { root: ROOT });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.details.mainDb, 'yuncms_test');
  assert.equal(result.details.migrationDb, 'yuncms_migration_test');
  assert.equal(result.details.upgradeDb, 'yuncms_upgrade_test');
  assert.equal(result.details.redisUrl, 'redis://127.0.0.1:6379/1');
});

test('validateStrictProfile rejects missing or disabled required flags', () => {
  const flags = [
    'YUNCMS_TEST_MYSQL',
    'YUNCMS_TEST_REDIS',
    'YUNCMS_TEST_MIGRATION',
    'YUNCMS_TEST_UPGRADE',
    'YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE',
    'YUNCMS_TEST_DOCKER',
  ];

  for (const flag of flags) {
    const envMissing = { ...VALID_STRICT_ENV };
    delete envMissing[flag];
    const missingResult = validateStrictProfile(envMissing, { root: ROOT });
    assert.equal(missingResult.ok, false);
    assert.ok(
      missingResult.errors.some((err) => err.includes(`${flag}=1 is required`)),
      `expected error for missing ${flag}`,
    );

    const envZero = { ...VALID_STRICT_ENV, [flag]: '0' };
    const zeroResult = validateStrictProfile(envZero, { root: ROOT });
    assert.equal(zeroResult.ok, false);
    assert.ok(
      zeroResult.errors.some((err) => err.includes(`${flag}=1 is required`)),
      `expected error for ${flag}=0`,
    );
  }
});

test('validateStrictProfile validates Redis URL presence and protocol', () => {
  const missing = validateStrictProfile({ ...VALID_STRICT_ENV, YUNCMS_TEST_REDIS_URL: '' }, { root: ROOT });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((err) => err.includes('YUNCMS_TEST_REDIS_URL is required')));

  const invalidUrl = validateStrictProfile({ ...VALID_STRICT_ENV, YUNCMS_TEST_REDIS_URL: 'not-a-url' }, { root: ROOT });
  assert.equal(invalidUrl.ok, false);
  assert.ok(invalidUrl.errors.some((err) => err.includes('valid URL')));

  const wrongProtocol = validateStrictProfile({ ...VALID_STRICT_ENV, YUNCMS_TEST_REDIS_URL: 'http://127.0.0.1:6379' }, { root: ROOT });
  assert.equal(wrongProtocol.ok, false);
  assert.ok(wrongProtocol.errors.some((err) => err.includes('redis: or rediss: protocol')));
});

test('validateStrictProfile never echoes sensitive Redis URL or credentials in error messages', () => {
  const secret = 'super_secret_token_12345';
  const invalidProtocol = `http://:${secret}@127.0.0.1:6379/1`;
  const result1 = validateStrictProfile({
    ...VALID_STRICT_ENV,
    YUNCMS_TEST_REDIS_URL: invalidProtocol,
  }, { root: ROOT });
  assert.equal(result1.ok, false);
  assert.ok(result1.errors.some((err) => err.includes('redis: or rediss: protocol')));
  assert.equal(result1.errors.some((err) => err.includes(secret)), false);

  const malformedUrl = `http://[invalid-bracket:${secret}`;
  const result2 = validateStrictProfile({
    ...VALID_STRICT_ENV,
    YUNCMS_TEST_REDIS_URL: malformedUrl,
  }, { root: ROOT });
  assert.equal(result2.ok, false);
  assert.ok(result2.errors.some((err) => err.includes('valid URL')));
  assert.equal(result2.errors.some((err) => err.includes(secret)), false);
});

test('validateStrictProfile enforces disposable database naming across all databases', () => {
  const mainProduction = validateStrictProfile({ ...VALID_STRICT_ENV, DB_DATABASE: 'yuncms_prod' }, { root: ROOT });
  assert.equal(mainProduction.ok, false);
  assert.ok(mainProduction.errors.some((err) => err.includes("DB_DATABASE must name a disposable database containing 'test', 'ci' or 'dev'")));

  const migrationProduction = validateStrictProfile({ ...VALID_STRICT_ENV, YUNCMS_MIGRATION_TEST_DB_DATABASE: 'migration_production' }, { root: ROOT });
  assert.equal(migrationProduction.ok, false);
  assert.ok(migrationProduction.errors.some((err) => err.includes("YUNCMS_MIGRATION_TEST_DB_DATABASE must name a disposable database")));

  const upgradeProduction = validateStrictProfile({ ...VALID_STRICT_ENV, YUNCMS_UPGRADE_TEST_DB_DATABASE: 'live_upgrade_db' }, { root: ROOT });
  assert.equal(upgradeProduction.ok, false);
  assert.ok(upgradeProduction.errors.some((err) => err.includes("YUNCMS_UPGRADE_TEST_DB_DATABASE must name a disposable database")));
});

test('validateStrictProfile rejects database name collisions between main, migration and upgrade fixtures', () => {
  const migCollidesWithMain = validateStrictProfile({
    ...VALID_STRICT_ENV,
    YUNCMS_MIGRATION_TEST_DB_DATABASE: 'yuncms_test',
  }, { root: ROOT });
  assert.equal(migCollidesWithMain.ok, false);
  assert.ok(migCollidesWithMain.errors.some((err) => err.includes('YUNCMS_MIGRATION_TEST_DB_DATABASE must be distinct from DB_DATABASE')));

  const upgCollidesWithMain = validateStrictProfile({
    ...VALID_STRICT_ENV,
    YUNCMS_UPGRADE_TEST_DB_DATABASE: 'yuncms_test',
  }, { root: ROOT });
  assert.equal(upgCollidesWithMain.ok, false);
  assert.ok(upgCollidesWithMain.errors.some((err) => err.includes('YUNCMS_UPGRADE_TEST_DB_DATABASE must be distinct from DB_DATABASE')));

  const upgCollidesWithMig = validateStrictProfile({
    ...VALID_STRICT_ENV,
    YUNCMS_UPGRADE_TEST_DB_DATABASE: 'yuncms_migration_test',
  }, { root: ROOT });
  assert.equal(upgCollidesWithMig.ok, false);
  assert.ok(upgCollidesWithMig.errors.some((err) => err.includes('YUNCMS_UPGRADE_TEST_DB_DATABASE must be distinct from YUNCMS_MIGRATION_TEST_DB_DATABASE')));
});

test('assertTestFilesExist verifies existing test files and rejects nonexistent paths', () => {
  assert.equal(
    assertTestFilesExist(['packages/cli/test/verification-runner.test.js'], ROOT),
    true,
  );

  assert.throws(
    () => assertTestFilesExist(['packages/cli/test/nonexistent-test-file.test.js'], ROOT),
    (err) => err.code === 'ERR_TEST_FILES_NOT_FOUND' && err.missingFiles.length === 1,
  );
});

test('parseTestSummary extracts counts from TAP reporter output', () => {
  const tapOutput = `
TAP version 13
# Subtest: example test
ok 1 - example test
  ---
  duration_ms: 2.1
  ...
1..1
# tests 42
# suites 2
# pass 40
# fail 1
# cancelled 0
# skipped 1
# todo 0
# duration_ms 523.45
`;

  const summary = parseTestSummary(tapOutput);
  assert.deepEqual(summary, {
    tests: 42,
    suites: 2,
    pass: 40,
    fail: 1,
    cancelled: 0,
    skipped: 1,
    todo: 0,
    durationMs: 523.45,
  });
  assert.equal(formatTestSummary(summary), 'tests: 42, pass: 40, fail: 1, skipped: 1, todo: 0, cancelled: 0');
});

test('parseTestSummary extracts counts from spec reporter output', () => {
  const specOutput = `
✔ sample test (1.2ms)
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 112.5
`;

  const summary = parseTestSummary(specOutput);
  assert.deepEqual(summary, {
    tests: 15,
    suites: 0,
    pass: 15,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    durationMs: 112.5,
  });
});

test('parseTestSummary rejects incomplete, corrupt, and mismatched summaries', () => {
  // Incomplete summary (only tests count)
  assert.equal(parseTestSummary('# tests 1\n'), null);

  // Missing required keys
  assert.equal(parseTestSummary('# tests 5\n# pass 5\n'), null);

  // Total mismatch: pass + fail + cancelled + skipped + todo (4) !== tests (5)
  const mismatchOutput = `
# tests 5
# suites 0
# pass 3
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 10.0
`;
  assert.equal(parseTestSummary(mismatchOutput), null);

  // Corrupt non-numeric value
  const corruptOutput = `
# tests abc
# suites 0
# pass 0
# fail 0
# cancelled 0
# skipped 0
# todo 0
`;
  assert.equal(parseTestSummary(corruptOutput), null);

  // Negative count
  const negativeOutput = `
# tests -1
# suites 0
# pass -1
# fail 0
# cancelled 0
# skipped 0
# todo 0
`;
  assert.equal(parseTestSummary(negativeOutput), null);
});

test('parseTestSummary returns null for non-test or empty output', () => {
  assert.equal(parseTestSummary(''), null);
  assert.equal(parseTestSummary('Building studio...\nDone in 2.3s'), null);
  assert.equal(parseTestSummary(null), null);
});

test('evaluateStrictSuiteResult rejects failures, missing summaries, skips, todos, and cancelled tests', () => {
  assert.equal(
    evaluateStrictSuiteResult(1, { tests: 1, pass: 0, fail: 1, skipped: 0, todo: 0, cancelled: 0 }).ok,
    false,
  );
  assert.equal(evaluateStrictSuiteResult(0, null).ok, false);
  assert.equal(
    evaluateStrictSuiteResult(0, { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0 }).ok,
    false,
  );
  assert.equal(
    evaluateStrictSuiteResult(0, { tests: 5, pass: 4, fail: 1, skipped: 0, todo: 0, cancelled: 0 }).ok,
    false,
  );
  assert.equal(
    evaluateStrictSuiteResult(0, { tests: 5, pass: 4, fail: 0, skipped: 1, todo: 0, cancelled: 0 }).ok,
    false,
  );
  assert.equal(
    evaluateStrictSuiteResult(0, { tests: 5, pass: 4, fail: 0, skipped: 0, todo: 1, cancelled: 0 }).ok,
    false,
  );
  assert.equal(
    evaluateStrictSuiteResult(0, { tests: 5, pass: 4, fail: 0, skipped: 0, todo: 0, cancelled: 1 }).ok,
    false,
  );

  const clean = evaluateStrictSuiteResult(0, { tests: 10, pass: 10, fail: 0, skipped: 0, todo: 0, cancelled: 0 });
  assert.equal(clean.ok, true);
});

test('early CLI rejection: scripts/verify.mjs rejects strict invocation before executing tests when required flags are missing', () => {
  const cleanEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'test',
  };

  const directStrict = spawnSync(
    process.execPath,
    ['scripts/verify.mjs', 'strict'],
    {
      cwd: ROOT,
      env: cleanEnv,
      encoding: 'utf8',
      timeout: 10_000,
    },
  );

  assert.equal(directStrict.status, 1);
  assert.ok(directStrict.stderr.includes('Strict release profile rejected:'));
  assert.ok(directStrict.stderr.includes('YUNCMS_TEST_MYSQL=1 is required'));
  assert.ok(directStrict.stderr.includes('YUNCMS_TEST_REDIS=1 is required'));
  assert.ok(directStrict.stderr.includes('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required'));
  assert.equal(directStrict.stdout.includes('complete source suite'), false);

  const optInStrict = spawnSync(
    process.execPath,
    ['scripts/verify.mjs', 'release'],
    {
      cwd: ROOT,
      env: { ...cleanEnv, YUNCMS_TEST_STRICT: '1' },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );

  assert.equal(optInStrict.status, 1);
  assert.ok(optInStrict.stderr.includes('Strict release profile rejected:'));
  assert.equal(optInStrict.stdout.includes('complete source suite'), false);
});

test('CLI argument guard: scripts/verify.mjs rejects invalid modes with code 2', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/verify.mjs', 'invalid-mode'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 10_000,
    },
  );

  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes('Usage: node scripts/verify.mjs [fast|full|release|strict]'));
});

test('pure strict-mode matrix: isStrictVerificationMode enforces flag and mode combinations', () => {
  const modes = ['fast', 'full', 'release', 'strict'];

  for (const mode of modes) {
    // 1. Without env / empty env
    assert.equal(
      isStrictVerificationMode(mode, {}),
      mode === 'strict',
      `mode ${mode} without env`,
    );

    // 2. With flag disabled ('0')
    assert.equal(
      isStrictVerificationMode(mode, { YUNCMS_TEST_STRICT: '0' }),
      mode === 'strict',
      `mode ${mode} with flag=0`,
    );

    // 3. With flag enabled ('1')
    assert.equal(
      isStrictVerificationMode(mode, { YUNCMS_TEST_STRICT: '1' }),
      mode === 'strict' || mode === 'release',
      `mode ${mode} with flag=1`,
    );
  }

  // 4. Default mode fallback ('full') when mode argument is omitted
  assert.equal(isStrictVerificationMode(undefined, {}), false);
  assert.equal(isStrictVerificationMode(undefined, { YUNCMS_TEST_STRICT: '1' }), false);
});
