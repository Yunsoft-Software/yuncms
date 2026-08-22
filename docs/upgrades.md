# YunCMS production upgrades

YunCMS includes a guarded CLI upgrade flow for npm-installed projects. The goal is to make a failed application/database upgrade recoverable instead of relying on ad-hoc `npm install` + manual SQL changes.

## Important deployment rule

The current upgrade flow is **maintenance-window based**, not zero-downtime deployment.

Stop the YunCMS service **at the supervisor level** first (systemd, PM2, Docker/Compose, Plesk process manager, etc.). Do not only kill a child process that the supervisor will immediately restart.

`yuncms backup` and `yuncms update` fail closed when the configured local YunCMS health endpoint is still reachable.

## Requirements

The project must:

- use Node.js 24 LTS;
- have `@yunsoft/yuncms` declared in project `package.json`;
- have the package installed in project `node_modules`;
- have `npm`, `mysqldump` and `mysql` available on `PATH`;
- use a MySQL account that can dump the YunCMS database and perform the DDL YunCMS already requires for schema management;
- have enough local disk for the database backup plus safety headroom.

If S3-compatible storage is configured, YunCMS does **not** download/copy the bucket during each update. Provider-side versioning/snapshots must be configured and explicitly acknowledged for the update.

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

- installed/current YunCMS version;
- target version resolution through npm;
- required CLI tools;
- MySQL connectivity;
- currently applied migration IDs;
- migration IDs shipped by the target npm package;
- migrations pending for the target;
- incompatible/unknown migration history;
- accidental downgrade attempts;
- local health endpoint still running;
- estimated database size and local free disk;
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

The database dump is streamed through gzip and then decompressed end-to-end before the backup is marked `complete: true`. A corrupt/truncated gzip therefore blocks the update before package installation starts.

Database passwords and S3 credentials are not written to the backup manifest.

## Update

After stopping the service supervisor:

```bash
yuncms update
```

To pin the release:

```bash
yuncms update --to 0.2.0
```

For S3 installations, only after provider-side object recovery/versioning has been verified:

```bash
yuncms update --to 0.2.0 --allow-unverified-s3
```

The flag name is deliberately explicit: it acknowledges that YunCMS itself has not backed up S3 objects.

The update sequence is:

1. run preflight;
2. create and verify the mandatory backup;
3. install the target `@yunsoft/yuncms` version with `--save-exact`;
4. recheck that YunCMS did not become reachable again;
5. execute the **newly installed** CLI's `bootstrap` command;
6. start the new runtime temporarily on the configured port;
7. require `/ready` to return `status=ready`;
8. gracefully stop the temporary verification runtime;
9. leave the project ready for the normal service supervisor to be started.

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

The expected recovery path is restoring the verified pre-update backup.

## Automatic rollback

If package installation, migration or new-runtime readiness verification fails after the backup exists, `yuncms update` attempts automatic rollback:

1. reset the target database's current tables/views;
2. restore `database.sql.gz`;
3. restore local Files, extensions, `.env`, `package.json` and `package-lock.json` to their pre-update state;
4. reinstall the old dependency graph (`npm ci` when a lockfile existed);
5. start the restored runtime temporarily and require `/ready`;
6. stop the temporary runtime again.

If rollback succeeds, the original update error is still returned, with rollback marked completed. The operator should inspect the failure before restarting production.

If rollback itself fails, YunCMS returns:

```text
UPDATE_ROLLBACK_FAILED
```

The backup directory is intentionally preserved for manual recovery.

## Manual restore

Restore is destructive and requires explicit confirmation:

```bash
yuncms restore /path/to/backup --yes
```

By default YunCMS refuses to restore a backup whose recorded database host/port/name differ from the current environment.

For an intentional disaster-recovery restore to a different database target:

```bash
yuncms restore /path/to/backup --yes --allow-different-database-target
```

The restore resets current database tables/views before importing the dump. This is required because importing an old dump over a partially migrated database would otherwise leave tables created only by the failed migration.

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
