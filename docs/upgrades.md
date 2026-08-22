# YunCMS production upgrades

YunCMS includes a guarded CLI upgrade flow for npm-installed projects. The goal is to make a failed application/database upgrade recoverable instead of relying on ad-hoc `npm install` plus manual SQL changes.

## Important deployment rule

The current upgrade flow is **maintenance-window based**, not zero-downtime deployment.

Stop every YunCMS process that uses the same database/storage **at the supervisor level** first (systemd, PM2, Docker/Compose, Plesk process manager, etc.). Do not only kill a child process that the supervisor will immediately restart.

For versions that contain the managed-upgrade startup gate, `backup`, `update` and destructive `restore` create an OS-temp project maintenance lock. Normal `yuncms start` and the API server refuse to start while that lock exists. Only the updater's in-memory random bypass token can start its temporary `/ready` verification process. The raw token is never written to the lock file; only its SHA-256 hash is stored.

This startup gate is defense in depth, **not permission to leave the supervisor enabled**. A runtime older than the startup-gate feature does not know how to read the new lock. The one-time transition from such an old version therefore requires the supervisor to be fully stopped for the entire maintenance operation.

Project maintenance identity is based on the physical project path, so symlink aliases to the same project resolve to the same operation lock.

YunCMS also holds a MySQL `GET_LOCK` maintenance lock for real backup/update/restore operations. This prevents two YunCMS maintenance commands from concurrently mutating the same database even when they were launched from different project directories. The lock connection is rechecked during the operation; ownership loss fails closed.

The database advisory lock does **not** stop an already-running API instance on another host. In multi-instance/container deployments, all instances that use the same database/storage must still be stopped before managed maintenance. The current updater is not a distributed rolling-deployment coordinator.

If a process is killed hard, a stale project lock may remain and will also block normal startup. YunCMS intentionally does not guess whether the lock is safe to remove. Verify that no backup/update/restore process remains before deleting the exact stale lock path reported by the CLI.

## Requirements

The project must:

- use Node.js 24 LTS;
- have `@yunsoft/yuncms` declared in project `package.json`;
- have the package installed in project `node_modules`;
- have `npm`, `mysqldump` and `mysql` available on `PATH`;
- use a MySQL account that can dump the YunCMS database and perform the DDL YunCMS already requires for schema management;
- use a database whose complete contents are owned/recoverable by this YunCMS deployment;
- have enough local disk for the database dump, local Files/extensions/project metadata snapshot and safety headroom;
- run the production process from the same physical project working directory used by the updater.

If S3-compatible storage is configured, YunCMS does **not** download/copy the bucket during each update. Provider-side versioning/snapshots must be configured and explicitly acknowledged for the update.

## Subprocess time limits

Managed updates bound external processes so a stuck package manager or database client cannot hold maintenance locks forever.

Defaults:

```text
YUNCMS_CLI_COMMAND_TIMEOUT_MS=900000
YUNCMS_DB_TOOL_TIMEOUT_MS=7200000
```

The first value covers npm/package/bootstrap commands (15 minutes by default). The second covers `mysql`/`mysqldump` (2 hours by default). On timeout YunCMS requests `SIGTERM`, escalates to `SIGKILL` after a grace period and returns a timeout error.

Increase these only after measuring a verified large production install/database. Do not use an arbitrarily huge value merely to hide a hung command.

## Dry run

Run this before a production maintenance window:

```bash
yuncms update --dry-run
```

Or inspect a specific target:

```bash
yuncms update --to 0.2.0 --dry-run
```

Preflight checks include:

- installed/current YunCMS version and dependency section;
- target version resolution through npm using SemVer precedence;
- target package migration IDs loaded from the target package itself;
- required CLI tools;
- MySQL connectivity;
- currently applied migration IDs;
- migrations pending for the target;
- unknown, duplicated or gapped/incompatible migration history;
- stale `applying`/`failed` migration-attempt state;
- accidental downgrade attempts, including stable-to-prerelease downgrades;
- local health endpoint still running;
- estimated database size;
- estimated local uploads/extensions/project-metadata snapshot size;
- local free disk and safety headroom;
- S3 backup acknowledgement requirement.

Dry-run does not modify the project database/package state.

## Backup

With the service supervisor stopped:

```bash
yuncms backup
```

Optional exact destination:

```bash
yuncms backup --output /srv/backups/yuncms-before-0.2.0
```

The backup contains:

```text
manifest.json
database.sql.gz
project/.env
project/package.json
project/package-lock.json
extensions/
files/
```

Entries that did not exist before the backup are recorded as absent rather than synthesized.

The database dump is streamed through gzip and then decompressed end-to-end before the backup is completed. A corrupt/truncated gzip therefore blocks the update before package installation starts.

### Backup format 2 integrity

New backups use manifest format `2`. The manifest records SHA-256 digests for:

- `database.sql.gz`;
- `.env` when present;
- `package.json` when present;
- `package-lock.json` when present;
- the complete deterministic `extensions/` tree when present;
- the complete deterministic local Files tree when present.

Restore recomputes these hashes **before database reset**. A modified copied file/tree fails with `BACKUP_INTEGRITY_MISMATCH`.

Managed backup/restore deliberately refuses symbolic links inside managed snapshot inputs because dereference/link semantics make exact portable recovery ambiguous.

Legacy format `1` backups remain readable for backward recovery and emit an explicit warning because they do not contain project-asset SHA-256 digests.

SHA-256 values inside the same manifest detect accidental corruption and uncoordinated modification. They are **not a cryptographic signature** against an attacker who can rewrite both the files and `manifest.json`. Store production backups in appropriately protected/immutable/versioned storage if malicious tampering is in scope.

Database passwords and S3 credentials are not written to the backup manifest. The protected `.env` snapshot itself intentionally contains the project's environment and must be secured as secret material.

A backup command rechecks service state and the MySQL maintenance lock after snapshot creation. If maintenance ownership is lost before the command can safely return the snapshot, the newly created backup is discarded and the command fails.

## Update

After stopping the service supervisor:

```bash
yuncms update
```

To pin the release:

```bash
yuncms update --to 0.2.0
```

If the currently installed YunCMS version predates the managed `update` command itself, invoke the already-published target CLI explicitly as the one-time bootstrap updater:

```bash\ nnpx --yes @yunsoft/yuncms@0.2.0 update --to 0.2.0
```

Remove the accidental space after `bash` if copying from a renderer; the command itself is:

```bash
npx --yes @yunsoft/yuncms@0.2.0 update --to 0.2.0
```

For this first transition, **the old runtime does not have the new startup gate**, so the supervisor must remain fully disabled throughout the operation. Once the installed project is on a gate-enabled YunCMS version, later managed updates gain the additional startup-lock protection.

For S3 installations, only after provider-side object recovery/versioning has been verified:

```bash
yuncms update --to 0.2.0 --allow-unverified-s3
```

The flag name is deliberately explicit: it acknowledges that YunCMS itself has not backed up S3 objects.

The update sequence is:

1. acquire the canonical per-project maintenance lock/startup marker;
2. acquire the MySQL database maintenance lock;
3. run preflight and reject recovery-required/migration-history problems;
4. recheck that the configured YunCMS service is stopped;
5. create and verify the mandatory format-2 backup;
6. if the package version differs, install the exact target while preserving its dependency section;
7. if the package already equals the target but DB migrations are pending, skip needless npm reinstall;
8. recheck service state and database maintenance ownership;
9. execute the target/local CLI's `bootstrap` command;
10. recheck service state and database maintenance ownership;
11. start the target runtime temporarily with the in-memory maintenance bypass token;
12. require `/ready` to return `status=ready`;
13. gracefully stop that temporary runtime;
14. recheck that no unexpected supervisor process is reachable;
15. release the database and project locks and leave production start to the normal supervisor.

There is intentionally no `--no-backup` update mode.

## Migration failure safety

YunCMS keeps the normal successful migration journal and an additional migration-attempt journal.

Before a migration starts it records:

- migration ID;
- status `applying`;
- completed statement index.

On success it records `applied`. On failure it records `failed` and a bounded error description.

If MySQL DDL partially succeeds and the process then fails, the next bootstrap does **not** blindly run the migration again. It fails with:

```text
DATABASE_MIGRATION_RECOVERY_REQUIRED
```

Managed update preflight also refuses to create a new "recovery" backup from a database that already contains an incomplete migration attempt. Recover from a known-good earlier backup first.

## Automatic rollback

If package installation, migration or new-runtime readiness verification fails after the backup exists, `yuncms update` attempts automatic rollback while the maintenance locks remain active:

1. revalidate backup manifest, gzip and format-2 SHA-256 asset integrity before deleting anything;
2. recheck that the configured YunCMS service is still stopped;
3. verify the MySQL maintenance lock is still owned by this operation;
4. reset the target database's current tables/views;
5. restore `database.sql.gz`;
6. restore local Files, extensions, `.env`, `package.json` and `package-lock.json` to their pre-update state;
7. reinstall the old dependency graph (`npm ci` when a lockfile existed);
8. recheck that no supervisor process became reachable;
9. start the restored runtime temporarily and require `/ready`;
10. stop the temporary runtime and recheck service/lock state.

If rollback succeeds, the original update error is still returned, with rollback marked completed. The operator should inspect the failure before starting production.

If rollback itself fails, YunCMS returns:

```text
UPDATE_ROLLBACK_FAILED
```

The backup directory is intentionally preserved for manual recovery.

## Manual restore

Restore is destructive. Keep the service supervisor stopped and provide explicit confirmation:

```bash
yuncms restore /path/to/backup --yes
```

By default YunCMS refuses to restore a backup whose recorded database host/port/name differ from the current environment.

For an intentional disaster-recovery restore to a different database target:

```bash
yuncms restore /path/to/backup --yes --allow-different-database-target
```

Cross-database restore preserves the current recovery environment's `.env` instead of replacing it with the source environment's DB address. The source `.env` remains inside the backup for inspection.

Before destructive reset, restore:

- validates manifest structure;
- confirms declared asset types/presence;
- refuses unsafe backup/restore path overlap;
- validates the gzip stream;
- validates format-2 SHA-256 integrity;
- checks restore-target shape/writeability as far as possible before mutation;
- rechecks the configured YunCMS health endpoint;
- rechecks database maintenance ownership.

Only then does it reset current database tables/views and import the dump.

## Starting production again

A successful `yuncms update` verifies the new runtime and then stops that temporary process. Start YunCMS with the same production supervisor used before the maintenance window.

Example only:

```bash
systemctl start my-yuncms.service
```

YunCMS intentionally does not execute arbitrary shell/service-manager restart commands from the update command.

## S3 note

Database/file metadata backup is not the same as object backup. For S3-compatible storage use provider-side capabilities such as bucket versioning, snapshots or a separately verified replication/backup policy.

Do not pass `--allow-unverified-s3` merely to bypass the guard; use it only after recovery of object storage has been verified outside YunCMS.

## Verification runbooks

Before calling this exact source state production-verified, complete the pending gates in `todo.md` and follow:

- `docs/codex-managed-upgrade-verification.md` for the original end-to-end managed-upgrade gate;
- `docs/codex-managed-upgrade-hardening.md` for format-2 integrity, maintenance-startup, timeout and first-transition/multi-instance edge cases.
