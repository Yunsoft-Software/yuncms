import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const MAINTENANCE_BYPASS_ENV = 'YUNCMS_MAINTENANCE_BYPASS_TOKEN';

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function maintenanceLockPath(cwd = process.cwd()) {
  const projectKey = sha256(resolve(cwd)).slice(0, 32);
  return join(tmpdir(), 'yuncms-update-locks', `${projectKey}.lock`);
}

export function hashMaintenanceBypassToken(token) {
  if (typeof token !== 'string' || token.length < 32) {
    const error = new Error('Maintenance bypass token must contain at least 32 characters');
    error.code = 'MAINTENANCE_BYPASS_TOKEN_INVALID';
    throw error;
  }
  return sha256(token);
}

function hashesEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function readMaintenanceState(path, readFileFn) {
  let text;
  try {
    text = await readFileFn(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  try {
    const state = JSON.parse(text);
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('invalid state');
    return state;
  } catch (cause) {
    const error = new Error(`YunCMS maintenance lock is unreadable or invalid: ${path}`);
    error.code = 'YUNCMS_MAINTENANCE_ACTIVE';
    error.lockPath = path;
    error.cause = cause;
    throw error;
  }
}

export async function assertMaintenanceStartupAllowed({
  cwd = process.cwd(),
  env = process.env,
  readFileFn = readFile,
} = {}) {
  const path = maintenanceLockPath(cwd);
  const state = await readMaintenanceState(path, readFileFn);
  if (!state) return true;

  const suppliedToken = env?.[MAINTENANCE_BYPASS_ENV];
  if (typeof suppliedToken === 'string' && suppliedToken.length >= 32) {
    const suppliedHash = sha256(suppliedToken);
    if (hashesEqual(suppliedHash, state.bypassTokenHash)) return true;
  }

  const error = new Error(
    `YunCMS maintenance is active for this project. Do not start the application until the maintenance operation finishes: ${path}`,
  );
  error.code = 'YUNCMS_MAINTENANCE_ACTIVE';
  error.lockPath = path;
  error.startedAt = typeof state.startedAt === 'string' ? state.startedAt : null;
  error.pid = Number.isInteger(state.pid) ? state.pid : null;
  throw error;
}
