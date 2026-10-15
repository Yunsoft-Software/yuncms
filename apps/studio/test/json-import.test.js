import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MAX_JSON_IMPORT_BYTES, parseJsonImportText, readJsonImportFile } from '../src/json-import.js';
import { exportFlowDefinition, importFlowDefinition } from '../src/flow-graph.js';

test('actual JSON Files preserve UTF-8, BOM, nested options and literal custom script source', async () => {
  const value = { name: 'Türkçe akış', options: { nested: [false, null, 42] }, code: "import { createHash } from 'node:crypto'; export default () => '{{ literal }}';" };
  const text = '\uFEFF' + JSON.stringify(value, null, 2);
  const loaded = await readJsonImportFile(new File([text], 'flow.json', { type: 'application/json' }));
  assert.deepEqual(parseJsonImportText(loaded), value); assert.equal(loaded.startsWith('\uFEFF'), false);
});

test('invalid, empty and non-JSON actual Files fail without exposing their contents in errors', async () => {
  for (const text of ['', '{broken', '<html>private source</html>']) {
    await assert.rejects(readJsonImportFile(new File([text], 'flow.json')), { code: 'JSON_IMPORT_INVALID', message: 'JSON_IMPORT_INVALID' });
    assert.throws(() => parseJsonImportText(text), { code: 'JSON_IMPORT_INVALID' });
  }
});

test('file and pasted JSON enforce the same byte boundary, including UTF-8 text', async () => {
  assert.equal(MAX_JSON_IMPORT_BYTES, 20 * 1024 * 1024);
  const limit = '"' + 'a'.repeat(MAX_JSON_IMPORT_BYTES - 2) + '"';
  assert.equal((await readJsonImportFile(new File([limit], 'limit.json'))).length, MAX_JSON_IMPORT_BYTES);
  const over = '"' + 'ş'.repeat(MAX_JSON_IMPORT_BYTES / 2) + '"';
  await assert.rejects(readJsonImportFile(new File([over], 'over.json')), { code: 'JSON_IMPORT_TOO_LARGE' });
  assert.throws(() => parseJsonImportText(over), { code: 'JSON_IMPORT_TOO_LARGE' });
});

test('all trigger and custom script JSON examples survive a real File export/import round trip without server identity', async () => {
  const files = ['webhook-greeting', 'schedule-read', 'script-order-total', 'script-commonjs'];
  for (const name of files) {
    const original = JSON.parse(readFileSync(new URL(`../../../docs/examples/flows/${name}.json`, import.meta.url), 'utf8'));
    const portable = exportFlowDefinition({ ...original, id: 'server-id', revision: 7, status: 'active' });
    const text = await readJsonImportFile(new File([JSON.stringify(portable, null, 2)], name + '.json'));
    const imported = importFlowDefinition(parseJsonImportText(text));
    assert.equal(imported.status, 'inactive'); assert.equal(imported.id, undefined); assert.equal(imported.revision, undefined);
    assert.equal(imported.trigger, original.trigger); assert.deepEqual(imported.operations, original.operations);
    assert.deepEqual(imported.options, original.options);
  }
});
