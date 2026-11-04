import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as current from '@yunsoft/yuncms-core';
import { createProjectBackup, restoreProjectBackup } from '../../packages/cli/src/project-backup.js';
import { AiSettingsStore } from '../../packages/api/src/ai/settings-store.js';

test('actual 0.1.47 core artifact upgrades content, permissions, files and encrypted settings; verified backup restores the old runtime', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1' || process.env.YUNCMS_TEST_UPGRADE !== '1', timeout: 120_000,
}, async () => {
  const config = current.loadConfig(process.env);
  if (process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE !== '1' || !/^yuncms_test_[a-z0-9_]+$/.test(config.database.database)
    || !['127.0.0.1', 'localhost', '::1'].includes(config.database.host)) throw new Error('A guarded local disposable MySQL environment is required');
  const dbName = `yuncms_test_upgrade_${randomBytes(8).toString('hex')}`;
  const admin = current.createDatabasePool({ ...config.database, database: undefined });
  await mkdir(resolve('.yuncms'), { recursive: true });
  const root = await mkdtemp(resolve('.yuncms/v2-upgrade-'));
  let database, created = false;
  try {
    const unpack = join(root, 'baseline'); await mkdir(unpack);
    let archive = process.env.YUNCMS_V2_BASELINE_CORE_PACKAGE;
    if (!archive) {
      const output = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '@yunsoft/yuncms-core@0.1.47', '--ignore-scripts', '--json', '--pack-destination', unpack], { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
      archive = join(unpack, JSON.parse(output)[0].filename);
    }
    archive = resolve(archive);
    const paths = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).split('\n').filter(Boolean);
    assert.ok(paths.every(path => path.startsWith('package/') && !path.split('/').includes('..')));
    execFileSync('tar', ['-xf', archive, '-C', unpack]);
    const manifest = JSON.parse(await readFile(join(unpack, 'package/package.json'), 'utf8'));
    assert.equal(manifest.name, '@yunsoft/yuncms-core'); assert.equal(manifest.version, '0.1.47');
    const previous = await import(pathToFileURL(join(unpack, 'package/src/index.js')).href);
    for (const name of Object.keys(previous)) assert.ok(name in current, `Removed public core export: ${name}`);
    await admin.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    database = current.createDatabasePool({ ...config.database, database: dbName });
    await previous.bootstrapDatabase(database);
    const cwd = join(root, 'project'); await mkdir(join(cwd, '.yuncms'), { recursive: true });
    const storage = previous.createStorageRegistry({ local: new previous.LocalStorageDriver({ root: join(cwd, '.yuncms/uploads') }) });
    const options = { database, storage, accountability: previous.createSystemAccountability() };
    const collections = new previous.CollectionsService(options);
    await collections.createOne({ collection: 'upgrade_articles', metadata: { displayTemplate: '{{ title }}', custom: { label: 'Türkçe 日本語' } } });
    for (const [field, type] of [['title', 'string'], ['body', 'json']]) await new previous.FieldsService(options).createOne('upgrade_articles', { field, type });
    const oldItems = new previous.ItemsService('upgrade_articles', options);
    const record = await oldItems.createOne({ title: 'Unicode Türkçe 日本語', body: { languages: ['tr', 'en', 'ja'], nested: ['One', 'İki'] } });
    const role = await new previous.RolesService(options).createOne({ name: 'Upgrade editor' });
    await new previous.PermissionsService(options).createOne({ role: role.id, collection: 'upgrade_articles', action: 'read', fields: ['id', 'title'] });
    const user = await new previous.UsersService(options).createOne({ email: 'upgrade@example.test', password: 'Disposable-upgrade-9812!', role: role.id });
    const file = await new previous.FilesService(options).createOne({ contents: Buffer.from('Original file Türkçe\n'), filenameDownload: 'fixture.txt', mimetype: 'text/plain' });
    const key = randomBytes(32), keyPath = join(cwd, '.yuncms/ai-settings.key');
    await writeFile(keyPath, key.toString('hex'), { mode: 0o600 });
    const ai = new AiSettingsStore({ database, key });
    await ai.update({ api_key: 'disposable-upgrade-secret', enabled: false, model: 'unused' });
    const env = { ...process.env, DB_DATABASE: dbName, FILES_LOCAL_ROOT: '.yuncms/uploads', S3_BUCKET: '' };
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ dependencies: { '@yunsoft/yuncms': '0.1.47' } }));
    await writeFile(join(cwd, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }));
    await writeFile(join(cwd, '.env'), `DB_HOST=127.0.0.1\nDB_DATABASE=${dbName}\nFILES_LOCAL_ROOT=.yuncms/uploads\n`);
    const backup = await createProjectBackup({ cwd, env, output: { log() {}, warn() {} } });
    assert.equal(backup.manifest.project.aiSettingsKey, true);
    const migration = await current.bootstrapDatabase(database);
    assert.ok(migration.newlyApplied.includes('0029-content-foundation'));
    const migrated = await new current.CollectionsService(options).readOne('upgrade_articles');
    assert.deepEqual(migrated.metadata.custom, { label: 'Türkçe 日本語' });
    assert.deepEqual(migrated.metadata.contentTracking, { enabled: true, history: false });
    const items = new current.ItemsService('upgrade_articles', options);
    assert.deepEqual(await items.readOne(record.id), record);
    assert.equal((await items.readEditState(record.id)).revision, '0');
    const editor = new current.ItemsService('upgrade_articles', { ...options, accountability: current.createAccountability({ user: user.id, role: role.id }) });
    assert.deepEqual(Object.keys(await editor.readOne(record.id)).sort(), ['id', 'title']);
    await assert.rejects(editor.updateOne(record.id, { title: 'Denied' }), { code: 'FORBIDDEN' });
    assert.ok((await ai.readRuntime()).apiKey === 'disposable-upgrade-secret', 'Encrypted AI settings changed during migration');
    assert.equal((await new current.FilesService(options).readContent(file.id)).contents.toString(), 'Original file Türkçe\n');
    await items.updateOne(record.id, { title: 'Upgraded edit' }, { expectedRevision: '0' });
    assert.equal((await items.readEditState(record.id)).revision, '1');
    await assert.rejects(items.updateOne(record.id, { title: 'Stale' }, { expectedRevision: '0' }), { code: 'ITEM_REVISION_CONFLICT' });
    assert.deepEqual((await current.bootstrapDatabase(database)).newlyApplied, []);
    await writeFile(keyPath, randomBytes(32).toString('hex'));
    await writeFile(join(cwd, '.yuncms/uploads', file.filename_disk), 'Damaged file');
    await current.closeDatabasePool(database); database = null;
    await restoreProjectBackup({ backupPath: backup.backupPath, cwd, env, output: { log() {}, warn() {} } });
    database = current.createDatabasePool({ ...config.database, database: dbName });
    assert.deepEqual((await previous.bootstrapDatabase(database)).newlyApplied, []);
    const restored = { ...options, database };
    assert.deepEqual(await new previous.ItemsService('upgrade_articles', restored).readOne(record.id), record);
    const [newTables] = await database.query("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'yuncms_item_versions'", [dbName]);
    assert.equal(newTables.length, 0);
    assert.equal((await new previous.FilesService(restored).readContent(file.id)).contents.toString(), 'Original file Türkçe\n');
    assert.ok((await readFile(keyPath, 'utf8')) === key.toString('hex'), 'Backup did not restore the AI key');
    assert.ok((await new AiSettingsStore({ database, key }).readRuntime()).apiKey === 'disposable-upgrade-secret', 'Restored encrypted settings cannot be decrypted');
  } finally {
    if (database) await current.closeDatabasePool(database);
    try { if (created) await admin.query(`DROP DATABASE \`${dbName}\``); }
    finally { await current.closeDatabasePool(admin); await rm(root, { recursive: true, force: true }); }
  }
});
