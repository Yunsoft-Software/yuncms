import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('API server enforces maintenance startup gate before opening the database pool', async () => {
  const source = await readFile(resolve(import.meta.dirname, '../src/server.js'), 'utf8');
  const maintenanceCall = source.indexOf('await assertMaintenanceStartupAllowed');
  const poolCreation = source.indexOf('createDatabasePool(config.database)');

  assert.ok(maintenanceCall >= 0, 'maintenance startup gate must remain in server entrypoint');
  assert.ok(poolCreation > maintenanceCall, 'maintenance startup gate must run before DB pool creation');
});
