import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Production installations also run on MariaDB, which rejects MySQL-only clauses.
async function sources(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sources(path));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

test('runtime SQL avoids shared-lock syntax that MariaDB rejects', async () => {
  for (const pkg of ['core', 'api']) {
    const root = fileURLToPath(new URL(`../../${pkg}/src`, import.meta.url));
    for (const file of await sources(root)) {
      assert.doesNotMatch(await readFile(file, 'utf8'), /\bFOR\s+SHARE\b/i, file);
    }
  }
});
