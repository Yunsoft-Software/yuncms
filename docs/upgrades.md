# YunCMS production upgrades

YunCMS includes a guarded CLI upgrade flow for npm-installed projects. The goal is to make a failed application/database upgrade recoverable instead of relying on ad-hoc `npm install` + manual SQL changes.

## Important deployment rule

The current upgrade flow is **maintenance-window based**, not zero-downtime deployment.

Stop the YunCMS service **at the supervisor level** first (systemd, PM2, Docker/Compose, Plesk process manager, etc.). Do not only kill a child process that the supervisor will immediately restart.

`yuncms backup`, `yuncms update` and destructive `yuncms restore ... --yes` fail closed when the configured local YunCMS health endpoint is still reachable. Managed `update` and destructive `restore` operations are also serialized by an atomic per-project lock stored under the operating-system temp directory, outside project data and backup trees.

If a process is killed hard, a stale lock may remain. YunCMS intentionally does not guess whether it is safe to remove that lock. Verify that no update/restore process is active before deleting a stale lock path reported by `UPDATE_ALREADY_RUNNING`.

## Requirements

The project must:

- use Node.js 24 LTS;
- have `@yunsoft/yuncms` declared in project `package.json`;
- have the package installed in project `node_modules`;
- have `npm`, `mysqldump` and `mysql` available on `PATH`;
- use a MySQL account that can dump the YunCMS database and perform the DDL YunCMS already requires for schema management;
- use a database whose complete contents are owned/recoverable by this YunCMS deployment;
- have enough local disk for the database dump, local Files/extensions/project metadata snapshot and safety headroom.

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

If the currently installed YunCMS version predates the managed `update` command itself, invoke the already-published target CLI explicitly as the one-time bootstrap updater:

```bash
npx --yes @yunsoft/yuncms@0.2.0 update --to 0.2.0
```

The target CLI still operates on the current project directory, reads the installed project version, creates the same mandatory backup and then installs/verifies the target locally. Once the project is on a version that includes managed updates, normal `yuncms update` can be used for later releases.

For S3 installations, only after provider-side object recovery/versioning has been verified:

```bash
yuncms update --to 0.2.0 --allow-unverified-s3
```

The flag name is deliberately explicit: it acknowledges that YunCMS itself has not backed up S3 objects.

The update sequence is:

1. acquire the project update lock;
2. run preflight;
3. recheck that the configured YunCMS service is stopped;
4. create and verify the mandatory backup;
5. install the target `@yunsoft/yuncms` version with `--save-exact`;
6. recheck that a supervisor did not restart YunCMS;
7. execute the **newly installed** CLI's `bootstrap` command;
8. start the new runtime temporarily on the configured port;
9. require `/ready` to return `status=ready`;
10. gracefully stop the temporary verification runtime;
11. release the update lock and leave the project ready for the normal service supervisor to be started.

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

1. revalidate the backup gzip and every asset that its manifest declares before deleting anything;
2. recheck that the configured YunCMS service is still stopped;
3. reset the target database's current tables/views;
4. restore `database.sql.gz`;
5. restore local Files, extensions, `.env`, `package.json` and `package-lock.json` to their pre-update state;
6. reinstall the old dependency graph (`npm ci` when a lockfile existed);
7. start the restored runtime temporarily and require `/ready`;
8. stop the temporary runtime again.

If rollback succeeds, the original update error is still returned, with rollback marked completed. The operator should inspect the failure before restarting production.

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

Before destructive reset, restore revalidates the database gzip and confirms that every manifest-declared local asset exists. It then rechecks the configured YunCMS health endpoint immediately before the reset. Only then does it reset current database tables/views and import the dump. This prevents corrupted backups from wiping a healthy database, catches supervisor auto-restart races, and prevents tables created only by a failed migration from surviving an old dump import.

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
