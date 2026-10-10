import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Anchored resolution strictly through installed core in /opt/yuncms
const require = createRequire('/opt/yuncms/package.json');
const coreEntry = require.resolve('@yunsoft/yuncms-core');
assert.ok(
  coreEntry.startsWith('/opt/yuncms/'),
  `Worker must resolve @yunsoft/yuncms-core strictly inside /opt/yuncms, got: ${coreEntry}`,
);
const core = await import(pathToFileURL(coreEntry).href);

const {
  CollectionsService,
  FieldsService,
  FilesService,
  HookEmitter,
  ItemsService,
  LocalStorageDriver,
  RolesService,
  SchemaCache,
  closeDatabasePool,
  createCoreServiceRegistry,
  createDatabasePool,
  createStorageRegistry,
  createSystemAccountability,
  loadConfig,
} = core;

const STATE_FILE_PATH = '/data/docker-backup-fixture-state.json';
const EXPECTED_DATABASE = 'yuncms_test_docker_restore';
const EXPECTED_COLLECTION = 'fixture_products';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertDisposableDatabase(config) {
  const databaseName = config?.database?.database;
  if (databaseName !== EXPECTED_DATABASE) {
    throw new Error(`Worker must only operate on exact database ${EXPECTED_DATABASE}, got: ${databaseName}`);
  }
}

async function handleSetup() {
  const config = loadConfig(process.env);
  assertDisposableDatabase(config);

  const database = createDatabasePool(config.database);
  const system = createSystemAccountability();
  const schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
  const emitter = new HookEmitter({ logger: { error() {} } });
  const services = createCoreServiceRegistry().toObject();
  const options = { database, accountability: system, schemaCache, emitter, services };

  try {
    // 1. Verify bootstrap created Public role, and ensure native admin fixture
    const roles = new RolesService(options);
    const existingRoles = await roles.readMany();
    const publicRole = existingRoles.find((r) => Boolean(r.public));
    assert.ok(publicRole, 'Public role must exist after bootstrap');

    let adminRole = existingRoles.find((r) => Boolean(r.admin));
    if (!adminRole) {
      adminRole = await roles.createOne({ name: 'Docker Fixture Admin', admin: true });
    }
    assert.ok(adminRole, 'Native administrator role fixture must be present');

    const [rolesColRows] = await database.query(
      `SELECT COLUMN_NAME, EXTRA, GENERATION_EXPRESSION
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'yuncms_roles' AND COLUMN_NAME = 'public_singleton'`,
      [config.database.database],
    );
    assert.equal(rolesColRows.length, 1, 'yuncms_roles.public_singleton generated column must exist');

    // 2. Create custom collection with STORED and VIRTUAL generated columns
    const collections = new CollectionsService(options);
    const fields = new FieldsService(options);
    const collectionName = EXPECTED_COLLECTION;
    await collections.createOne({ collection: collectionName });
    await fields.createOne(collectionName, { field: 'name', type: 'string' });
    await fields.createOne(collectionName, { field: 'price', type: 'integer' });
    await fields.createOne(collectionName, { field: 'qty', type: 'integer' });

    await database.query(
      `ALTER TABLE \`${collectionName}\`
       ADD COLUMN \`subtotal\` INT GENERATED ALWAYS AS (\`price\` * \`qty\`) STORED,
       ADD COLUMN \`total_with_fee\` INT GENERATED ALWAYS AS (\`price\` * \`qty\` + 15) VIRTUAL`,
    );

    // Insert test row
    const items = new ItemsService(collectionName, options);
    const item = await items.createOne({
      name: 'Mechanical Keyboard',
      price: 120,
      qty: 2,
    });

    const [rows] = await database.query(
      `SELECT id, name, price, qty, subtotal, total_with_fee FROM \`${collectionName}\` WHERE id = ?`,
      [item.id],
    );
    assert.equal(rows[0].subtotal, 240, 'Initial STORED generated column subtotal mismatch');
    assert.equal(rows[0].total_with_fee, 255, 'Initial VIRTUAL generated column total_with_fee mismatch');

    // 3. Upload test file via FilesService using { local: driver } signature
    const storageRoot = process.env.FILES_LOCAL_ROOT || '/data/uploads';
    const storage = createStorageRegistry({
      local: new LocalStorageDriver({ root: storageRoot }),
    });
    const filesService = new FilesService({
      database,
      accountability: system,
      storage,
    });
    const filePayload = Buffer.from('YunCMS Docker backup-restore regression file content 2026-10-10\n');
    const fileHash = createHash('sha256').update(filePayload).digest('hex');
    const uploadedFile = await filesService.createOne({
      contents: filePayload,
      filenameDownload: 'backup-fixture-doc.txt',
      mimetype: 'text/plain',
    });

    // 4. Save state for subsequent mutate and verify stages
    const state = {
      collectionName,
      itemId: item.id,
      itemName: 'Mechanical Keyboard',
      itemPrice: 120,
      itemQty: 2,
      expectedSubtotal: 240,
      expectedTotalWithFee: 255,
      adminRoleId: adminRole.id,
      publicRoleId: publicRole.id,
      fileId: uploadedFile.id,
      fileDisk: uploadedFile.filename_disk,
      fileHash,
      fileSize: filePayload.byteLength,
    };
    await writeFile(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf8');
    console.log(`[docker-backup-worker] Setup complete: ${JSON.stringify(state)}`);
  } finally {
    await closeDatabasePool(database);
  }
}

async function handleMutate() {
  const config = loadConfig(process.env);
  assertDisposableDatabase(config);

  const state = JSON.parse(await readFile(STATE_FILE_PATH, 'utf8'));
  assert.equal(state.collectionName, EXPECTED_COLLECTION, 'State collectionName must match expected literal fixture_products');
  assert.match(state.itemId, UUID_REGEX, 'State itemId must be a valid UUID');
  assert.match(state.fileDisk, /^[0-9a-f-]{36}$/i, 'State fileDisk must be a valid UUID string');

  const database = createDatabasePool(config.database);

  try {
    // 1. Mutate row in database
    await database.query(
      `UPDATE \`${EXPECTED_COLLECTION}\` SET \`price\` = 9999, \`qty\` = 1, \`name\` = 'MUTATED' WHERE id = ?`,
      [state.itemId],
    );
    const [mutatedRows] = await database.query(
      `SELECT name, price, subtotal FROM \`${EXPECTED_COLLECTION}\` WHERE id = ?`,
      [state.itemId],
    );
    assert.equal(mutatedRows[0].name, 'MUTATED');
    assert.equal(mutatedRows[0].price, 9999);
    assert.equal(mutatedRows[0].subtotal, 9999);

    // 2. Mutate file on disk
    const storageRoot = process.env.FILES_LOCAL_ROOT || '/data/uploads';
    const storageDriver = new LocalStorageDriver({ root: storageRoot });
    const diskPath = storageDriver.pathFor(state.fileDisk);
    await writeFile(diskPath, Buffer.from('CORRUPTED/MUTATED FILE DATA'), 'utf8');

    console.log('[docker-backup-worker] Mutate complete: database row and disk file modified');
  } finally {
    await closeDatabasePool(database);
  }
}

async function handleVerify() {
  const config = loadConfig(process.env);
  assertDisposableDatabase(config);

  const state = JSON.parse(await readFile(STATE_FILE_PATH, 'utf8'));
  assert.equal(state.collectionName, EXPECTED_COLLECTION, 'State collectionName must match expected literal fixture_products');
  assert.match(state.itemId, UUID_REGEX, 'State itemId must be a valid UUID');
  assert.match(state.fileId, UUID_REGEX, 'State fileId must be a valid UUID');
  assert.match(state.fileDisk, /^[0-9a-f-]{36}$/i, 'State fileDisk must be a valid UUID string');
  assert.match(state.adminRoleId, UUID_REGEX, 'State adminRoleId must be a valid UUID');
  assert.match(state.publicRoleId, UUID_REGEX, 'State publicRoleId must be a valid UUID');

  const database = createDatabasePool(config.database);
  const system = createSystemAccountability();
  const schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
  const emitter = new HookEmitter({ logger: { error() {} } });
  const services = createCoreServiceRegistry().toObject();
  const options = { database, accountability: system, schemaCache, emitter, services };

  try {
    // 1. Assert roles restored from native DTO projection (excludes internal public_singleton)
    const roles = new RolesService(options);
    const existingRoles = await roles.readMany();
    const adminRole = existingRoles.find((r) => r.id === state.adminRoleId);
    const publicRole = existingRoles.find((r) => r.id === state.publicRoleId);
    assert.ok(adminRole, 'Restored Administrator role must exist');
    assert.equal(Boolean(adminRole.admin), true, 'Administrator role admin flag must be preserved');

    assert.ok(publicRole, 'Restored Public role must exist');
    assert.equal(Boolean(publicRole.public), true, 'Public role public flag must be preserved');

    // Query generated physical column separately via bound SQL (safe projection omits internal public_singleton)
    const [roleRows] = await database.query(
      'SELECT id, public_singleton FROM yuncms_roles WHERE id IN (?, ?)',
      [state.adminRoleId, state.publicRoleId],
    );
    const adminDbRole = roleRows.find((r) => r.id === state.adminRoleId);
    const publicDbRole = roleRows.find((r) => r.id === state.publicRoleId);
    assert.ok(adminDbRole, 'Admin role row must exist in yuncms_roles table');
    assert.ok(publicDbRole, 'Public role row must exist in yuncms_roles table');
    assert.equal(adminDbRole.public_singleton, null, 'Administrator public_singleton must be NULL in database');
    assert.equal(publicDbRole.public_singleton, 1, 'Public role public_singleton must be 1 in database');

    // 2. Assert generated columns definitions in information_schema
    const [cols] = await database.query(
      `SELECT COLUMN_NAME, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [config.database.database, EXPECTED_COLLECTION],
    );
    const subtotalCol = cols.find((c) => c.COLUMN_NAME === 'subtotal');
    const totalCol = cols.find((c) => c.COLUMN_NAME === 'total_with_fee');
    assert.ok(subtotalCol, 'STORED column subtotal must exist after restore');
    assert.match(subtotalCol.EXTRA, /STORED GENERATED/i, 'subtotal column must be STORED GENERATED');
    assert.ok(totalCol, 'VIRTUAL column total_with_fee must exist after restore');
    assert.match(totalCol.EXTRA, /VIRTUAL GENERATED/i, 'total_with_fee column must be VIRTUAL GENERATED');

    // 3. Assert restored item values and generated column computation
    const [restoredRows] = await database.query(
      `SELECT id, name, price, qty, subtotal, total_with_fee FROM \`${EXPECTED_COLLECTION}\` WHERE id = ?`,
      [state.itemId],
    );
    assert.equal(restoredRows.length, 1, 'Restored row must exist');
    assert.equal(restoredRows[0].name, state.itemName, 'Restored row name mismatch');
    assert.equal(restoredRows[0].price, state.itemPrice, 'Restored row price mismatch');
    assert.equal(restoredRows[0].qty, state.itemQty, 'Restored row qty mismatch');
    assert.equal(restoredRows[0].subtotal, state.expectedSubtotal, 'Restored STORED generated subtotal mismatch');
    assert.equal(restoredRows[0].total_with_fee, state.expectedTotalWithFee, 'Restored VIRTUAL generated total_with_fee mismatch');

    // 4. Assert restored file contents and hash
    const storageRoot = process.env.FILES_LOCAL_ROOT || '/data/uploads';
    const storageDriver = new LocalStorageDriver({ root: storageRoot });
    const restoredFileBuffer = await storageDriver.get(state.fileDisk);
    assert.equal(restoredFileBuffer.byteLength, state.fileSize, 'Restored file size mismatch');
    const restoredHash = createHash('sha256').update(restoredFileBuffer).digest('hex');
    assert.equal(restoredHash, state.fileHash, 'Restored file SHA-256 mismatch');

    // 5. Assert FilesService metadata using { local: driver } signature
    const storage = createStorageRegistry({
      local: storageDriver,
    });
    const filesService = new FilesService({
      database,
      accountability: system,
      storage,
    });
    const restoredFileRecord = await filesService.readOne(state.fileId);
    assert.ok(restoredFileRecord, 'File record must exist in database after restore');
    assert.equal(restoredFileRecord.filename_download, 'backup-fixture-doc.txt');
    assert.equal(String(restoredFileRecord.filesize), String(state.fileSize), 'Restored file record filesize mismatch');

    console.log('[docker-backup-worker] Verify complete: generated columns, roles and files verified successfully');
  } finally {
    await closeDatabasePool(database);
  }
}

const mode = process.argv[2];
if (mode === 'setup') {
  await handleSetup();
} else if (mode === 'mutate') {
  await handleMutate();
} else if (mode === 'verify') {
  await handleVerify();
} else {
  throw new Error(`Unknown mode: ${mode}. Supported: setup, mutate, verify`);
}
