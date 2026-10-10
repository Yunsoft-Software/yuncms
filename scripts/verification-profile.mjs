import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export function assertTestFilesExist(files, root = process.cwd()) {
  const missing = [];
  for (const file of files) {
    const absolute = resolve(root, file);
    try {
      const stat = statSync(absolute);
      if (!stat.isFile()) missing.push(file);
    } catch {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    const error = new Error(`Preflight test file verification failed: ${missing.length} file(s) do not exist`);
    error.code = 'ERR_TEST_FILES_NOT_FOUND';
    error.missingFiles = missing;
    throw error;
  }
  return true;
}

export function validateStrictProfile(env = process.env, { root = process.cwd(), hasDockerIntegration } = {}) {
  const errors = [];

  const requiredFlags = [
    ['YUNCMS_TEST_MYSQL', '1'],
    ['YUNCMS_TEST_REDIS', '1'],
    ['YUNCMS_TEST_MIGRATION', '1'],
    ['YUNCMS_TEST_UPGRADE', '1'],
    ['YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE', '1'],
  ];

  const dockerTestExists = hasDockerIntegration ?? existsSync(resolve(root, 'test/integration/multi-user-lock.test.js'));
  if (dockerTestExists) {
    requiredFlags.push(['YUNCMS_TEST_DOCKER', '1']);
  }

  for (const [flag, expected] of requiredFlags) {
    if (env[flag] !== expected) {
      errors.push(`${flag}=${expected} is required for strict release verification`);
    }
  }

  const redisUrl = (env.YUNCMS_TEST_REDIS_URL || '').trim();
  if (!redisUrl) {
    errors.push('YUNCMS_TEST_REDIS_URL is required when YUNCMS_TEST_REDIS=1');
  } else {
    try {
      const parsed = new URL(redisUrl);
      if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
        errors.push('YUNCMS_TEST_REDIS_URL must use redis: or rediss: protocol');
      }
    } catch {
      errors.push('YUNCMS_TEST_REDIS_URL must be a valid URL');
    }
  }

  const mainDb = (env.DB_DATABASE || '').trim();
  if (!mainDb) {
    errors.push('DB_DATABASE is required and must name a disposable database');
  } else if (!/(test|ci|dev)/i.test(mainDb)) {
    errors.push(`DB_DATABASE must name a disposable database containing 'test', 'ci' or 'dev' (received: '${mainDb}')`);
  }

  const migrationDb = (env.YUNCMS_MIGRATION_TEST_DB_DATABASE || '').trim();
  if (!migrationDb) {
    errors.push('YUNCMS_MIGRATION_TEST_DB_DATABASE is required and must name a disposable database');
  } else if (!/(test|ci|dev)/i.test(migrationDb)) {
    errors.push(`YUNCMS_MIGRATION_TEST_DB_DATABASE must name a disposable database containing 'test', 'ci' or 'dev' (received: '${migrationDb}')`);
  }

  const upgradeDb = (env.YUNCMS_UPGRADE_TEST_DB_DATABASE || '').trim();
  if (!upgradeDb) {
    errors.push('YUNCMS_UPGRADE_TEST_DB_DATABASE is required and must name a disposable database');
  } else if (!/(test|ci|dev)/i.test(upgradeDb)) {
    errors.push(`YUNCMS_UPGRADE_TEST_DB_DATABASE must name a disposable database containing 'test', 'ci' or 'dev' (received: '${upgradeDb}')`);
  }

  if (mainDb && migrationDb && mainDb === migrationDb) {
    errors.push('YUNCMS_MIGRATION_TEST_DB_DATABASE must be distinct from DB_DATABASE to avoid destructive resets of active fixtures');
  }
  if (mainDb && upgradeDb && mainDb === upgradeDb) {
    errors.push('YUNCMS_UPGRADE_TEST_DB_DATABASE must be distinct from DB_DATABASE to avoid destructive resets of active fixtures');
  }
  if (migrationDb && upgradeDb && migrationDb === upgradeDb) {
    errors.push('YUNCMS_UPGRADE_TEST_DB_DATABASE must be distinct from YUNCMS_MIGRATION_TEST_DB_DATABASE to avoid destructive fixture collisions');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    details: {
      mainDb,
      migrationDb,
      upgradeDb,
      redisUrl,
    },
  };
}

export function parseTestSummary(output) {
  if (typeof output !== 'string' || !output.trim()) return null;

  const lines = output.split(/\r?\n/);
  const counts = {};
  let durationMs = null;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    const match = line.match(/^[#ℹ]\s*([a-z_]+)\s+([\d.]+)\s*$/);
    if (!match) continue;
    const [, key, valStr] = match;
    if (key === 'duration_ms') {
      if (durationMs === null) {
        const parsed = Number.parseFloat(valStr);
        if (Number.isFinite(parsed) && parsed >= 0) durationMs = parsed;
      }
      continue;
    }
    if (counts[key] === undefined) {
      const parsed = Number.parseInt(valStr, 10);
      if (Number.isSafeInteger(parsed) && parsed >= 0 && String(parsed) === valStr) {
        counts[key] = parsed;
      }
    }
  }

  const requiredKeys = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
  for (const k of requiredKeys) {
    if (counts[k] === undefined) return null;
  }

  const { tests, pass, fail, cancelled, skipped, todo } = counts;
  if (pass + fail + cancelled + skipped + todo !== tests) {
    return null;
  }

  return {
    tests,
    suites: counts.suites ?? 0,
    pass,
    fail,
    cancelled,
    skipped,
    todo,
    durationMs,
  };
}

export function formatTestSummary(summary) {
  if (!summary) return 'no summary';
  return `tests: ${summary.tests}, pass: ${summary.pass}, fail: ${summary.fail}, skipped: ${summary.skipped}, todo: ${summary.todo}, cancelled: ${summary.cancelled}`;
}

export function evaluateStrictSuiteResult(status, summary) {
  if (status !== 0) {
    return { ok: false, reason: `process failed with exit code ${status}` };
  }
  if (!summary) {
    return { ok: false, reason: 'missing structured test summary' };
  }
  if (summary.tests === 0) {
    return { ok: false, reason: 'zero executed tests' };
  }
  if (summary.fail > 0) {
    return { ok: false, reason: `${summary.fail} failing test(s)` };
  }
  if (summary.skipped > 0) {
    return { ok: false, reason: `${summary.skipped} skipped test(s)` };
  }
  if (summary.todo > 0) {
    return { ok: false, reason: `${summary.todo} todo test(s)` };
  }
  if (summary.cancelled > 0) {
    return { ok: false, reason: `${summary.cancelled} cancelled test(s)` };
  }
  return { ok: true };
}

export function isStrictVerificationMode(mode = 'full', env = process.env) {
  return mode === 'strict' || (mode === 'release' && env?.YUNCMS_TEST_STRICT === '1');
}

export const isStrictMode = isStrictVerificationMode;
