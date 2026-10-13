import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createServer } from "vite";

test("development HTTP serves public UI but denies credentials, native state and upload bytes", async t => {
  const root = await mkdtemp(join(tmpdir(), "yuncms-example-private-"));
  const marker = "private-fixture-never-serve";
  const paths = [".demo-accounts.json", ".demo-state.json", ".verification.json", ".env.local", "local.pem", ".git/config", ".yuncms/ai-settings.key", "uploads/private.txt"];
  await writeFile(join(root, "index.html"), "<h1>Public example fixture</h1>");
  for (const path of paths) { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), marker); }
  const server = await createServer({ root, configFile: resolve(import.meta.dirname, "../vite.config.js"), logLevel: "silent", server: { host: "127.0.0.1", port: 0 } });
  t.after(async () => { await server.close(); await rm(root, { recursive: true, force: true }); });
  await server.listen(); const base = "http://127.0.0.1:" + server.httpServer.address().port;
  assert.equal((await fetch(base + "/")).status, 200);
  for (const path of paths) for (const url of ["/" + path, "/" + path + "?raw", "/@fs/" + join(root, path)]) {
    const response = await fetch(base + url);
    assert.ok([403, 404].includes(response.status), url + " must be denied");
    assert.equal((await response.text()).includes(marker), false);
  }
});
