import { createHash, timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const MAINTENANCE_BYPASS_ENV = 'YUNCMS_MAINTENANCE_BYPASS_TOKEN';

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function canonicalProjectPath(cwd = process.cwd()) {
  const absolute = resolve(cwd);
  try {
    return realpathSync.native ? realpathSync.native(absolute) : realpathSync(absolute);
  } catch {
    return absolute;
  }
}

export function resolveUserIdentity({
  userInfoFn = userInfo,
  getuidFn = typeof process.getuid === 'function' ? () => process.getuid() : null,
} = {}) {
  if (typeof getuidFn === 'function') {
    const rawUid = getuidFn();
    if (Number.isSafeInteger(rawUid) && rawUid >= 0) {
      return String(rawUid);
    }
    const err = new Error(`Operating system user identity is unavailable or invalid: ${rawUid}`);
    err.code = 'OS_USER_IDENTITY_UNAVAILABLE';
    throw err;
  }
  let info;
  try {
    info = userInfoFn();
  } catch (error) {
    const err = new Error('Operating system user identity is unavailable');
    err.code = 'OS_USER_IDENTITY_UNAVAILABLE';
    err.cause = error;
    throw err;
  }
  const name = info?.username;
  if (!name || typeof name !== 'string') {
    const err = new Error('Operating system user identity is unavailable');
    err.code = 'OS_USER_IDENTITY_UNAVAILABLE';
    throw err;
  }
  return sha256(name).slice(0, 32);
}

export function maintenanceLockPath(cwd = process.cwd(), options = {}) {
  const projectKey = sha256(canonicalProjectPath(cwd)).slice(0, 32);
  const tempRoot = options?.tempRoot ?? tmpdir();
  const identity = resolveUserIdentity(options);
  return join(tempRoot, `yuncms-update-locks-${identity}`, `${projectKey}.lock`);
}

export function legacyMaintenanceLockPath(cwd = process.cwd(), options = {}) {
  const projectKey = sha256(canonicalProjectPath(cwd)).slice(0, 32);
  const tempRoot = options?.tempRoot ?? tmpdir();
  return join(tempRoot, 'yuncms-update-locks', `${projectKey}.lock`);
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

export async function assertSecureUserParentDir(parentDir, {
  lstatFn = lstat,
  getuidFn = typeof process.getuid === 'function' ? () => process.getuid() : null,
} = {}) {
  let st;
  try {
    st = await lstatFn(parentDir);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  const isSymlink = typeof st.isSymbolicLink === 'function' ? st.isSymbolicLink() : false;
  if (isSymlink) {
    const error = new Error(`YunCMS maintenance directory is an insecure symbolic link: ${parentDir}`);
    error.code = 'YUNCMS_MAINTENANCE_ACTIVE';
    error.parentDir = parentDir;
    throw error;
  }

  const isDir = typeof st.isDirectory === 'function' ? st.isDirectory() : false;
  if (!isDir) {
    const error = new Error(`YunCMS maintenance path is not a directory: ${parentDir}`);
    error.code = 'YUNCMS_MAINTENANCE_ACTIVE';
    error.parentDir = parentDir;
    throw error;
  }

  if (typeof getuidFn === 'function') {
    const raw = getuidFn();
    if (!Number.isSafeInteger(raw) || raw < 0) {
      const error = new Error(`Operating system user identity is invalid: ${raw}`);
      error.code = 'YUNCMS_MAINTENANCE_ACTIVE';
      error.parentDir = parentDir;
      throw error;
    }
    const currentUid = raw;

    if (typeof st.uid === 'number' && st.uid !== currentUid) {
      const error = new Error(
        `YunCMS maintenance directory is not owned by current user (owner UID ${st.uid}, current UID ${currentUid}): ${parentDir}`,
      );
      error.code = 'YUNCMS_MAINTENANCE_ACTIVE';
      error.parentDir = parentDir;
      throw error;
    }

    const mode = typeof st.mode === 'number' ? st.mode : 0;
    const isPrivate = (mode & 0o077) === 0;
    if (!isPrivate) {
      const error = new Error(
        `YunCMS maintenance directory has insecure permissions (expected 0700): ${parentDir}`,
      );
      error.code = 'YUNCMS_MAINTENANCE_ACTIVE';
      error.parentDir = parentDir;
      throw error;
    }
  }
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

export async function probeLegacyMaintenanceLock({
  cwd = process.cwd(),
  tempRoot,
  readFileFn = readFile,
  lstatFn = lstat,
  getuidFn = typeof process.getuid === 'function' ? () => process.getuid() : null,
} = {}) {
  const legacyPath = legacyMaintenanceLockPath(cwd, { tempRoot });
  let state;
  try {
    state = await readMaintenanceState(legacyPath, readFileFn);
  } catch (error) {
    const causeCode = error?.cause?.code || error?.code;
    if (causeCode === 'EACCES' || causeCode === 'EPERM') {
      const legacyParent = dirname(legacyPath);
      let st;
      try {
        st = await lstatFn(legacyParent);
      } catch (statError) {
        const failClosedError = new Error(
          `YunCMS legacy maintenance directory is inaccessible: ${legacyParent}`,
        );
        failClosedError.code = 'YUNCMS_MAINTENANCE_ACTIVE';
        failClosedError.lockPath = legacyPath;
        failClosedError.cause = error;
        throw failClosedError;
      }

      let currentUid = null;
      if (typeof getuidFn === 'function') {
        const raw = getuidFn();
        if (Number.isSafeInteger(raw) && raw >= 0) {
          currentUid = raw;
        } else {
          const failClosedError = new Error(
            `YunCMS legacy maintenance directory has invalid user identity: ${raw}`,
          );
          failClosedError.code = 'YUNCMS_MAINTENANCE_ACTIVE';
          failClosedError.lockPath = legacyPath;
          throw failClosedError;
        }
      }

      const isSymlink = typeof st.isSymbolicLink === 'function' ? st.isSymbolicLink() : false;
      const isDir = typeof st.isDirectory === 'function' ? st.isDirectory() : false;
      const parentUid = st.uid;
      const mode = typeof st.mode === 'number' ? st.mode : 0;
      const hasGroupOrWorldTraversal = (mode & 0o011) !== 0;
      const isPrivateToOwner = (mode & 0o077) === 0;
      const isForeignUid = typeof parentUid === 'number' && currentUid !== null && parentUid !== currentUid;

      if (!isSymlink && isDir && isForeignUid && isPrivateToOwner && !hasGroupOrWorldTraversal) {
        // Non-symlink private directory owned by another UID with no group/world traversal. Safe to ignore.
        return null;
      }

      // Own, unknown owner, symlink, or insecure permissions fail-closed
      const failClosedError = new Error(
        `YunCMS legacy maintenance lock is inaccessible or insecure: ${legacyPath}`,
      );
      failClosedError.code = 'YUNCMS_MAINTENANCE_ACTIVE';
      failClosedError.lockPath = legacyPath;
      failClosedError.cause = error;
      throw failClosedError;
    }
    throw error;
  }

  if (!state) return null;
  return { path: legacyPath, state };
}

function assertBypassTokenAllowed(state, lockPath, env) {
  const suppliedToken = env?.[MAINTENANCE_BYPASS_ENV];
  if (typeof suppliedToken === 'string' && suppliedToken.length >= 32) {
    const suppliedHash = sha256(suppliedToken);
    if (hashesEqual(suppliedHash, state?.bypassTokenHash)) return true;
  }

  const error = new Error(
    `YunCMS maintenance is active for this project. Do not start the application until the maintenance operation finishes: ${lockPath}`,
  );
  error.code = 'YUNCMS_MAINTENANCE_ACTIVE';
  error.lockPath = lockPath;
  error.startedAt = typeof state?.startedAt === 'string' ? state.startedAt : null;
  error.pid = Number.isInteger(state?.pid) ? state.pid : null;
  throw error;
}

export async function assertMaintenanceStartupAllowed({
  cwd = process.cwd(),
  env = process.env,
  readFileFn = readFile,
  lstatFn = lstat,
  tempRoot,
  getuidFn = typeof process.getuid === 'function' ? () => process.getuid() : null,
  userInfoFn = userInfo,
} = {}) {
  const options = {
    cwd,
    env,
    readFileFn,
    lstatFn,
    tempRoot,
    getuidFn,
    userInfoFn,
  };

  // 1. Check legacy lock path (0.1.26 compatibility)
  const legacy = await probeLegacyMaintenanceLock(options);
  if (legacy) {
    assertBypassTokenAllowed(legacy.state, legacy.path, env);
  }

  // 2. Validate current per-user parent directory security if it exists
  const currentPath = maintenanceLockPath(cwd, options);
  const currentParent = dirname(currentPath);
  await assertSecureUserParentDir(currentParent, { lstatFn, getuidFn });

  // 3. Check current per-user lock
  const currentState = await readMaintenanceState(currentPath, readFileFn);
  if (currentState) {
    assertBypassTokenAllowed(currentState, currentPath, env);
  }

  return true;
}
