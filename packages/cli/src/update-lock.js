import { mkdir, open, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export function updateLockPath(cwd = process.cwd()) {
  return join(resolve(cwd), '.yuncms', 'update.lock');
}

export async function acquireUpdateLock({
  cwd = process.cwd(),
  now = new Date(),
  pid = process.pid,
} = {}) {
  const path = updateLockPath(cwd);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const locked = new Error(
        `Another YunCMS update/restore operation may already be running. Inspect and remove the stale lock only after verifying no operation is active: ${path}`,
      );
      locked.code = 'UPDATE_ALREADY_RUNNING';
      locked.lockPath = path;
      throw locked;
    }
    throw error;
  }

  try {
    await handle.writeFile(`${JSON.stringify({ pid, startedAt: now.toISOString() }, null, 2)}\n`, 'utf8');
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(path, { force: true }).catch(() => {});
    throw error;
  }

  let released = false;
  return {
    path,
    async release() {
      if (released) return;
      released = true;
      await handle.close().catch(() => {});
      await rm(path, { force: true });
    },
  };
}
