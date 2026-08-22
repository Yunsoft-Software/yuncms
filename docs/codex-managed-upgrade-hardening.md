# Codex managed-upgrade hardening verification

This runbook covers source-hardening added after the original managed-upgrade implementation. It is intentionally separate from `docs/codex-managed-upgrade-verification.md` so the additional release gates are easy to rerun when backup, lock, subprocess or recovery code changes.

Do **not** use a production database for destructive tests.

## 1. Required environment

Use:

- Node.js 24 LTS;
- npm 11+;
- MySQL 8-compatible server;
- `mysql` and `mysqldump` clients available on `PATH`;
- a dedicated disposable DB whose name contains `test`, `ci` or `dev`;
- enough disk for at least two realistic local backup copies during manual experiments;
- a process supervisor matching production when testing restart races.

Record exact versions without secrets:

```bash
node --version
npm --version
mysql --version
mysqldump --version
```

## 2. Source suites

Run:

```bash
npm ci
npm run test:fast
npm test
npm run test:release
```

The fast suite must include at least these upgrade-hardening files:

```text
packages/core/test/maintenance-state.test.js
packages/api/test/maintenance-startup.test.js
packages/cli/test/backup-integrity.test.js
packages/cli/test/database-backup-process.test.js
packages/cli/test/maintenance-lock.test.js
packages/cli/test/process-runner.test.js
packages/cli/test/restore-command.test.js
packages/cli/test/restore-validation.test.js
packages/cli/test/runtime-probe-maintenance.test.js
packages/cli/test/service-state.test.js
packages/cli/test/start-maintenance.test.js
packages/cli/test/update-dependency-section.test.js
packages/cli/test/update-lock.test.js
packages/cli/test/update-preflight.test.js
packages/cli/test/update-same-version.test.js
packages/cli/test/upgrade.test.js
```

Failure of any file is a release blocker. Do not remove a failing regression merely to make the suite green.

## 3. Dedicated destructive MySQL suite

Create a database used by no other test/process. Then set:

```bash
export YUNCMS_TEST_MYSQL=1
export YUNCMS_TEST_UPGRADE=1
export YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1
export YUNCMS_UPGRADE_TEST_DB_DATABASE=yuncms_upgrade_test
```

Also configure DB host/user/password as required by the existing integration harness.

Run:

```bash
npm run test:upgrade:mysql
```

Expected:

- partial DDL is journaled and blind retry is rejected;
- real `mysqldump` backup can be restored after destructive mutation;
- data and local project snapshot return to the pre-update state;
- MySQL maintenance-lock exclusion works when covered by the current integration suite.

After the test, independently inspect the disposable DB and confirm no unexpected objects remain.

## 4. Backup format 2 integrity

With YunCMS stopped, create a fresh backup:

```bash
yuncms backup --output /tmp/yuncms-integrity-test
```

Inspect `manifest.json` without publishing its contents. Expected:

- `format` is `2`;
- `complete` is `true`;
- `integrity.algorithm` is `sha256`;
- database digest is a 64-character hexadecimal SHA-256;
- each present `.env`, package file, extensions tree and local Files tree has a digest;
- absent assets have `null` integrity values;
- no DB password, S3 access key or S3 secret exists as a manifest field/value.

Do not confuse the intentionally copied `project/.env` with manifest metadata: the `.env` snapshot contains secrets by design and must be protected.

### 4.1 File tamper

Copy the backup. Modify only:

```text
project/package.json
```

Attempt restore into a disposable target:

```bash
yuncms restore /tmp/tampered-backup --yes
```

Expected:

```text
BACKUP_INTEGRITY_MISMATCH
```

Verify **before and after** that no database object was dropped.

### 4.2 Directory-tree tamper

Repeat separately for:

- one file under `files/`;
- one file under `extensions/`;
- adding a new unexpected file to either tree;
- deleting one existing file from either tree.

Every case must fail before DB reset.

### 4.3 Database-byte tamper

Alter/truncate `database.sql.gz`.

Expected one of the pre-destructive errors, depending on the corruption:

```text
BACKUP_DATABASE_INVALID
BACKUP_DATABASE_EMPTY
BACKUP_INTEGRITY_MISMATCH
```

No table/view may be dropped.

### 4.4 Manifest tamper

Change a format-2 digest to a non-SHA value and retry restore.

Expected:

```text
BACKUP_MANIFEST_INVALID
```

Again confirm DB is untouched.

### 4.5 Legacy format 1

Use a real backup produced by the previous format-1 implementation if available.

Expected:

- restore remains supported for backward recovery;
- CLI emits the legacy-integrity warning;
- gzip/asset-presence safety checks still run;
- format 1 is not falsely described as having project-tree SHA-256 protection.

## 5. Symbolic-link safety

On a POSIX disposable project, make one managed source a symlink, for example `.env` or an entry within a Files/extensions tree.

Run backup.

Expected:

```text
BACKUP_SYMLINK_UNSUPPORTED
```

No completed backup directory should be advertised.

Also try to restore into a target where a managed target path itself is a symlink. It must fail before DB reset.

## 6. Project maintenance startup gate

Use a version that already includes the maintenance-startup feature.

1. Stop the supervisor.
2. Start a real `yuncms backup`, `restore`, or `update` and pause it at a safe test hook/slow external command while its project lock exists.
3. In another shell, run:

```bash
yuncms start
```

Expected:

```text
YUNCMS_MAINTENANCE_ACTIVE
```

The API server must not open a DB pool/listening socket.

Direct server start must also be blocked. Use the actual packaged API server entrypoint rather than inventing a different application entrypoint.

### 6.1 Temporary readiness bypass

During a real managed update, verify the updater's own temporary runtime still reaches `/ready` while the project lock exists.

Confirm:

- the raw bypass token is not present in the lock file;
- only its SHA-256 hash is present;
- the token is not persisted to project `.env`;
- normal `yuncms start` without that token remains blocked;
- the temporary probe exits and the lock is later removed.

Do not print the bypass token into test logs.

### 6.2 Symlink project alias

Create a symlink alias to the same project directory.

Verify a lock acquired from the real path also blocks `yuncms start` from the alias path and vice versa. Both paths must resolve to the same lock identity.

## 7. Supervisor restart race

Use the same supervisor type as production.

### Gate-enabled source version

1. Start YunCMS under the supervisor.
2. Stop the supervisor correctly.
3. Start update/backup so the project maintenance lock is created.
4. Intentionally ask the supervisor to start YunCMS while maintenance is still active.

Expected: process startup fails closed with `YUNCMS_MAINTENANCE_ACTIVE`; no request reaches the maintenance DB through that process.

### First transition from a pre-gate version

Repeat using an old package that does **not** contain the startup gate and invoke the new updater through `npx`.

Expected operational rule: the supervisor must remain completely stopped. The old runtime cannot honor a feature it does not contain. Treat any successful old-runtime auto-restart during this first transition as a failed deployment test.

This gate must remain documented; source code in the new updater cannot retroactively change the already-installed old server process.

## 8. Database maintenance lock

From two separate project directories configured to the same disposable DB, start two maintenance commands concurrently.

Expected: the second command fails with:

```text
DATABASE_MAINTENANCE_LOCK_UNAVAILABLE
```

Then terminate/release the first and confirm the second can acquire the lock.

### 8.1 Lock ownership loss

In a controlled test, force the MySQL connection that owns `GET_LOCK` to disappear during a long-running maintenance operation.

At the next ownership checkpoint expect:

```text
DATABASE_MAINTENANCE_LOCK_LOST
```

For `yuncms backup`, a newly created snapshot must not be returned as successful; the failed snapshot should be discarded.

For update/restore, do not continue to another destructive phase after ownership loss.

## 9. External-command timeout gates

Defaults:

```text
YUNCMS_CLI_COMMAND_TIMEOUT_MS=900000
YUNCMS_DB_TOOL_TIMEOUT_MS=7200000
```

### 9.1 Generic command timeout

In a disposable harness, substitute/hook an npm/bootstrap command that intentionally hangs beyond a shortened configured timeout.

Expected:

```text
COMMAND_TIMEOUT
```

Verify the child receives termination and is not left running after the CLI returns.

### 9.2 mysqldump timeout

Use a wrapper in a disposable PATH that intentionally hangs as `mysqldump`, with a short `YUNCMS_DB_TOOL_TIMEOUT_MS`.

Expected:

```text
DATABASE_TOOL_TIMEOUT
```

Verify no orphan wrapper/client remains and no completed backup is advertised.

### 9.3 mysql restore timeout

Repeat for the `mysql` restore client.

Expected `DATABASE_TOOL_TIMEOUT`; restore must be considered failed and require operator inspection/recovery.

### 9.4 Large legitimate DB

After the timeout-failure tests, test a realistically large disposable DB with production-like latency. If the 2-hour default is insufficient for legitimate operation, measure and set an explicit larger value within the supported maximum rather than disabling timeout behavior.

## 10. Same-package database drift

Put the project package and installed package at the same target version while leaving one target migration unapplied.

Run:

```bash
yuncms update --to <same-version>
```

Expected:

- it does **not** return the clean "already on requested version" result;
- it creates the mandatory backup;
- it does **not** reinstall the exact same npm package;
- it runs target `bootstrap`;
- it performs the readiness probe;
- migration applies exactly once.

If an incomplete migration attempt exists instead, preflight must fail before backup with the recovery-required blocker.

## 11. Backup final-state revalidation

Simulate maintenance lock loss or unexpected process reachability immediately after snapshot creation.

For standalone `yuncms backup` expected behavior:

- command fails;
- the just-created snapshot is not returned as usable;
- lock-loss case marks the failure as backup discarded and removes that snapshot directory.

For managed update, any maintenance ownership/service-state failure before package mutation must stop the update before install/bootstrap.

## 12. Multi-instance boundary

This updater is currently a maintenance-window coordinator, not a distributed rolling-deployment system.

Test with two API instances on different hosts/containers using the same disposable DB/storage:

1. leave instance B running;
2. stop only instance A and attempt update from A.

This setup must be classified as **unsupported/unsafe operational usage**, even though the local startup marker protects A. The MySQL maintenance lock serializes other maintenance commands but does not freeze arbitrary API writes from B.

Production procedure must stop **all** instances sharing that DB/storage before backup/update/restore.

Do not mark multi-instance managed update supported until YunCMS has a distributed maintenance/read-write barrier designed specifically for it.

## 13. Evidence to retain

For every release candidate retain, without secrets:

- git commit SHA/branch;
- Node/npm/mysql/mysqldump versions;
- exact test commands and exit status;
- disposable DB name;
- backup format number;
- hashes/checksums of non-secret test fixtures where useful;
- expected error codes observed in negative tests;
- supervisor type/version and restart-race result;
- S3 provider/versioning configuration when S3 applies;
- confirmation that all YunCMS instances were stopped for the maintenance test.

Do not retain DB passwords, API tokens, S3 secrets, `.env` contents or the maintenance bypass token in test evidence.
