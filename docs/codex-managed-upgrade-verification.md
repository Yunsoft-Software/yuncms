# Codex verification runbook: managed backup / restore / update

This runbook is for validating the `22-08-2026` managed upgrade implementation in a real Node 24 + MySQL environment.

It is intentionally more strict than ordinary local smoke testing. A passing source suite alone does **not** prove that `mysqldump`, `mysql`, npm package replacement, a process supervisor, real MySQL DDL and rollback work together correctly.

## Non-negotiable safety rules

1. Work on branch `22-08-2026` only.
2. Do not use GitHub Actions.
3. Do not run destructive upgrade tests against production, staging containing valuable data, or a database shared with another application.
4. The destructive database name must contain `test`, `ci` or `dev`.
5. Use a **dedicated** database for the managed-upgrade suite. Do not reuse the ordinary integration DB.
6. Keep the production/service supervisor stopped during real backup/restore/update tests unless a test explicitly verifies the running-service guard.
7. Never pass database passwords as CLI arguments. Use the environment / `.env` path already supported by YunCMS.
8. Do not mark a TODO item complete only because a command exits zero. Verify database rows, schema objects, files, package versions and expected error codes.
9. Do not delete a failed-update backup until rollback/recovery has been independently verified.
10. Keep commits small if a source fix is required. Do not mix test-environment fixes with unrelated product changes.

---

## 1. Environment gate

Run:

```bash
node --version
npm --version
mysql --version
mysqldump --version
```

Expected:

- Node major is exactly `24`;
- npm is `11+`;
- `mysql` and `mysqldump` are executable from `PATH`.

Then install exactly from the branch checkout:

```bash
npm ci
```

If `npm ci` changes `package-lock.json`, stop and investigate. A verification run must not silently rewrite the lockfile.

---

## 2. Source regression gates

Run in this order:

```bash
npm run test:fast
npm test
npm run test:release
```

Expected:

- all three exit `0`;
- the fast suite includes the managed-upgrade CLI tests;
- the full suite auto-discovers every `packages/cli/test/*.test.js` file;
- `test:release` builds Studio and checks publishable package contracts.

Pay special attention to these source regressions:

```text
packages/core/test/bootstrap.test.js
packages/cli/test/database-backup-options.test.js
packages/cli/test/restore-command.test.js
packages/cli/test/restore-validation.test.js
packages/cli/test/service-state.test.js
packages/cli/test/update-lock.test.js
packages/cli/test/update-preflight.test.js
packages/cli/test/upgrade.test.js
```

Expected behaviors covered by those tests include:

- partial migration attempts fail closed;
- common MySQL dump options do not expose the DB password;
- corrupt/empty dumps are rejected;
- missing manifest-declared assets are rejected before DB reset;
- cross-DB restore preserves the current target `.env`;
- restore performs a second stopped-service check immediately before destructive reset;
- wildcard bind hosts are probed through a usable local address;
- concurrent update/restore locking fails closed;
- prerelease SemVer ordering prevents stable-to-prerelease downgrades;
- dry-run performs no mutation;
- successful update sequence is backup -> install -> bootstrap -> runtime probe;
- migration failure invokes rollback and preserves the original update error after successful rollback.

---

## 3. Dedicated destructive MySQL integration suite

Create a dedicated empty database. Example name:

```text
yuncms_upgrade_test
```

Do **not** reuse the DB configured for other integration tests.

Export the normal YunCMS DB connection values plus these gates:

```bash
export YUNCMS_TEST_MYSQL=1
export YUNCMS_TEST_UPGRADE=1
export YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1
export YUNCMS_UPGRADE_TEST_DB_DATABASE=yuncms_upgrade_test
```

Also provide the normal connection variables used by YunCMS:

```text
DB_HOST
DB_PORT
DB_USER
DB_PASSWORD
DB_SSL
```

Run only the dedicated suite first:

```bash
npm run test:upgrade:mysql
```

Expected test 1: partial DDL recovery

- statement 1 creates a real InnoDB table;
- statement 2 fails after statement 1 has committed implicitly;
- `yuncms_schema_migration_attempts.status = 'failed'`;
- `statement_index = 1`;
- retry returns `DATABASE_MIGRATION_RECOVERY_REQUIRED`;
- retry does not blindly re-run statement 1;
- test cleanup removes its synthetic migration attempt and table.

Expected test 2: real backup/restore round trip

- `mysqldump` creates `database.sql.gz`;
- gzip verification reports non-zero decompressed bytes;
- fixture DB row is snapshotted;
- local upload, extension, `.env`, `package.json`, `package-lock.json` are snapshotted;
- DB and local files are deliberately mutated;
- an extra table and view are created after backup;
- restore resets the DB and imports the dump;
- pre-backup fixture row/value returns;
- post-backup extra table/view disappear;
- pre-backup local upload/extension/package/env content returns;
- manifest does not contain the database password or S3 secret.

After the suite, confirm the dedicated DB is empty or otherwise cleaned as expected.

---

## 4. Real CLI help / packaging contract

Run:

```bash
node packages/cli/bin/yuncms.js help
```

Expected commands:

```text
yuncms init
yuncms bootstrap
yuncms start
yuncms backup
yuncms restore
yuncms update
yuncms update --dry-run
```

Then inspect publishable contents:

```bash
npm pack --dry-run --json --workspace=@yunsoft/yuncms
npm pack --dry-run --json --workspace=@yunsoft/yuncms-core
npm pack --dry-run --json --workspace=@yunsoft/yuncms-api
```

Verify the CLI package includes every new runtime file needed by `backup`, `restore` and `update`. In particular, do not publish a CLI package that references a source file omitted by the package `files` contract.

---

## 5. Manual backup consistency smoke

Use a disposable npm project with:

- `@yunsoft/yuncms` installed;
- a valid `.env` pointing to a disposable DB;
- one local upload;
- one local extension;
- `package.json` and `package-lock.json`.

Ensure YunCMS is stopped at the supervisor level.

Run:

```bash
yuncms backup
```

Expected backup tree:

```text
.yuncms/backups/<timestamp>/
  manifest.json
  database.sql.gz
  project/.env
  project/package.json
  project/package-lock.json
  extensions/
  files/
```

Checks:

1. `manifest.complete === true`.
2. `database.verifiedDecompressedBytes > 0`.
3. `manifest.json` contains no DB password.
4. `manifest.json` contains no S3 secret/access key.
5. `database.sql.gz` can be decompressed fully.
6. Local file bytes match the source snapshot.
7. Extension bytes match the source snapshot.
8. Backup directory permissions are not world-readable.
9. Default `.yuncms/` backup location remains ignored by git.
10. A second backup gets a distinct path and does not overwrite the first.

Also test:

```bash
yuncms backup --output /absolute/disposable/path
```

Verify an existing destination fails rather than being overwritten.

---

## 6. Running-service guard

Start YunCMS normally on the configured `HOST` / `PORT`.

While it is reachable, run:

```bash
yuncms backup
yuncms update --to <valid-newer-version>
```

Expected:

```text
UPDATE_APPLICATION_RUNNING
```

and no backup/package/DB mutation.

Repeat bind-address checks for:

```text
HOST=127.0.0.1
HOST=0.0.0.0
HOST=::
```

For wildcard binds, the local probe must use a reachable loopback address rather than attempting to HTTP-connect to the wildcard literal.

Supervisor race test:

1. run YunCMS under the actual supervisor used for deployment;
2. kill only the child process;
3. let the supervisor restart it;
4. invoke update;
5. verify the second stopped-service check catches the restart before migration/destructive restore;
6. stop/disable the supervisor itself;
7. verify update can proceed.

---

## 7. Restore validation before destruction

Take a valid disposable backup.

### Corrupt gzip

Make a copy of the backup and truncate/corrupt `database.sql.gz`.

Run:

```bash
yuncms restore /path/to/corrupt-backup --yes
```

Expected:

```text
BACKUP_DATABASE_INVALID
```

Verify the current DB tables still exist and were not reset.

### Missing declared asset

Copy a valid backup, leave its manifest unchanged, and delete one declared asset such as:

```text
project/package.json
```

Run restore.

Expected:

```text
BACKUP_ASSET_MISSING
```

Again verify no DB reset occurred.

### Wrong target DB

Point current environment at another disposable DB and restore a backup recorded for the original DB.

Without override, expected:

```text
BACKUP_DATABASE_TARGET_MISMATCH
```

No DB reset should occur.

---

## 8. Cross-database disaster recovery

Prepare:

```text
source DB:   yuncms_source_test
recovery DB: yuncms_recovery_test
```

Take a backup from source.

Point the current `.env` at `yuncms_recovery_test` and run:

```bash
yuncms restore /path/to/source-backup --yes --allow-different-database-target
```

Expected:

- backup DB contents are imported into `yuncms_recovery_test`;
- the **current recovery `.env` remains unchanged**;
- the source `.env` remains available only inside the backup directory;
- starting YunCMS afterward connects to recovery DB, not source DB.

This exact `.env` preservation must be verified; an apparently successful cross-DB restore that rewrites `.env` back to source DB is a failure.

---

## 9. Operation lock / crash recovery

With one update/restore operation holding the project lock, start another destructive operation against the same project.

Expected:

```text
UPDATE_ALREADY_RUNNING
```

Then verify two different project directories receive different lock paths and do not block each other.

Crash test:

1. start a disposable update;
2. hard-kill the updater;
3. verify the OS-temp lock remains;
4. verify the next update refuses to start;
5. inspect process table and make certain no old updater/npm/mysql/mysqldump process remains;
6. only then remove the stale lock manually;
7. perform backup/DB/package inspection before retrying.

Do not add automatic stale-lock deletion merely to make this test easier.

---

## 10. SemVer / downgrade gates

Source tests already verify SemVer precedence. Also exercise the real CLI with published versions when available.

Cases:

```text
current 1.0.0-beta.2 -> target 1.0.0-beta.11 : allowed
current 1.0.0-rc.1   -> target 1.0.0         : allowed
current 1.0.0         -> target 1.0.0-rc.1    : blocked
current 1.1.0         -> target 1.0.9         : blocked
```

Blocked cases must include:

```text
UPDATE_DOWNGRADE_FORBIDDEN
```

and must not create a backup or alter package/DB state during a dry-run/preflight failure.

---

## 11. Migration-history compatibility

On a disposable DB, add a synthetic migration ID to `yuncms_schema_migrations` that is not present in the target package.

Run:

```bash
yuncms update --to <target> --dry-run
```

Expected blocker:

```text
UPDATE_MIGRATION_HISTORY_INCOMPATIBLE
```

Remove the synthetic row afterward.

Never test this by altering a production migration ID.

---

## 12. First upgrade from a version that has no `update` command

This test is only possible after the new CLI has been published.

From a disposable project running an older YunCMS release that predates managed update, with the service stopped, invoke the new CLI explicitly:

```bash
npx --yes @yunsoft/yuncms@<new-version> update --to <new-version>
```

Expected:

- the new CLI performs preflight against the old installed project;
- mandatory backup is created before mutation;
- project dependency updates to exact new version;
- target migrations apply;
- temporary runtime reaches `/ready`;
- temporary runtime is stopped afterward;
- normal supervisor can then start the upgraded project.

Do not mark this scenario passed using only the source checkout; it specifically validates the published-package bootstrap path.

---

## 13. Successful published-version update

Requires two real published/disposable versions, for example `<old>` and `<new>`, where `<new>` has at least one additional migration.

Install `<old>` into a disposable project and seed representative data.

Stop the service supervisor and run:

```bash
yuncms update --to <new>
```

Verify in order:

1. preflight reports old/new versions and pending migration IDs;
2. backup exists before package mutation;
3. package.json/package-lock contain exact `<new>`;
4. bootstrap is executed from the newly installed local CLI;
5. new migration exists exactly once in migration journal;
6. `/ready` passes in temporary probe runtime;
7. temporary probe process exits;
8. no stray API process remains;
9. original data remains correct;
10. normal supervisor starts the new runtime successfully.

Also install a real extension and repeat once so extension startup is covered by readiness probing.

---

## 14. Real rollback fault matrix

Source unit tests exercise rollback orchestration with injected failures. For a production confidence run, reproduce as many of these as practical in a disposable environment.

### A. Migration failure after backup

Use a disposable test release/migration that intentionally fails after at least one DDL statement.

Expected:

- update reports failure;
- automatic rollback revalidates backup before DB reset;
- old DB snapshot returns;
- old package.json/package-lock return;
- old local Files/extensions/.env return;
- `npm ci` is used when old lockfile existed;
- old runtime reaches `/ready`;
- original update error is returned with `rollbackPerformed=true`;
- backup remains on disk.

### B. New runtime startup failure

Use a disposable target build or extension that throws during startup after migrations complete.

Expected: same full rollback as above.

### C. Rollback failure

In a disposable environment only, make the rollback path fail deliberately (for example make DB restore unavailable after an intentional update failure).

Expected final error:

```text
UPDATE_ROLLBACK_FAILED
```

Verify the error retains both update and rollback context and the backup is preserved for manual recovery.

### D. Supervisor restart during rollback

Cause the supervisor to restart YunCMS before rollback reaches destructive reset.

Expected:

- `beforeDestructive` stopped-service guard prevents DB reset;
- rollback is reported failed rather than modifying a live DB;
- backup remains available;
- operator must stop supervisor and recover manually.

---

## 15. S3 deployment gate

With S3-compatible storage configured, run update without acknowledgement.

Expected blocker:

```text
UPDATE_S3_BACKUP_UNVERIFIED
```

Before using:

```bash
yuncms update --allow-unverified-s3
```

prove provider-side recovery separately:

- bucket versioning/snapshot/replication is enabled;
- a test object can be restored after overwrite/delete;
- metadata DB rollback plus object-store rollback produces a consistent file record/object pair.

Verify `manifest.json`:

- may contain bucket identifier;
- does not contain access key;
- does not contain secret key;
- keeps `objectsBackedUp=false`.

---

## 16. Final evidence Codex should leave

For each executed gate, record:

- exact branch commit SHA;
- Node/npm/mysql/mysqldump versions;
- DB engine/version;
- exact commands executed;
- exit codes;
- important error codes for negative tests;
- backup path used;
- before/after package version;
- before/after migration IDs;
- DB row/schema checks used to prove restore/rollback;
- supervisor type and commands used;
- whether S3/local storage was tested;
- any skipped scenario and the reason it could not be executed.

Do not write secrets, tokens or database passwords into the report.

Only remove the corresponding `todo.md` upgrade items after the evidence proves the actual environment behavior.
