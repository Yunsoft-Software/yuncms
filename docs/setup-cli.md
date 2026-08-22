# YunCMS CLI

This document describes the current Node.js 24 CLI behavior.

## Runtime

The CLI accepts Node.js 24.x only. Unsupported majors fail with `UNSUPPORTED_NODE_VERSION` before command execution.

`.env` is loaded through the Node.js runtime; no `dotenv` dependency is required.

## Commands

### `yuncms init`

Interactive first-run setup:

1. validates Node 24;
2. creates `.env` only when it does not already exist;
3. asks for MySQL connection details with secret-safe password input;
4. writes `.env` with exclusive-create behavior and mode `0600`;
5. verifies MySQL connectivity;
6. runs bootstrap migrations;
7. checks for an existing administrator;
8. when needed, asks for admin email/password + confirmation;
9. creates/reuses the Administrator role and creates the first admin exactly once;
10. prints API/Studio addresses and next steps.

Rerunning `init` reuses the existing `.env`, reruns safe bootstrap checks and never silently creates a second initial administrator.

### `yuncms bootstrap`

Non-interactive/environment-driven database bootstrap:

```bash
yuncms bootstrap
```

It validates connectivity, obtains the bootstrap advisory lock, applies missing core migrations, reports schema version and closes the pool on success or failure.

The migration runner records both successful migrations and active/failed attempts. If a DDL migration partially executes and fails, YunCMS refuses a blind retry with `DATABASE_MIGRATION_RECOVERY_REQUIRED`; restore the verified pre-upgrade backup instead.

`bootstrap` does not create the first admin; use interactive `init` for that current workflow.

### `yuncms start`

```bash
yuncms start
```

The CLI resolves the installed `@yunsoft/yuncms-api` server entry and spawns it with the caller's current working directory and environment. This keeps project `.env`, extension discovery and relative local-storage paths rooted in the user's project rather than the CLI package directory.

Signals are forwarded to the API child so the API can run its graceful HTTP/MySQL shutdown path.

### `yuncms backup`

Create a verified pre-upgrade/disaster-recovery snapshot while the service supervisor is stopped:

```bash
yuncms backup
```

Optional destination:

```bash
yuncms backup --output /srv/backups/yuncms-2026-08-22
```

The command refuses to snapshot while the configured local YunCMS health endpoint is reachable. It streams `mysqldump` through gzip, verifies the gzip stream end-to-end, and snapshots `.env`, package metadata, local uploads and local `extensions/` when present.

S3 objects are not copied; provider-side object backup/versioning is required.

### `yuncms restore`

Restore is intentionally destructive and requires explicit confirmation:

```bash
yuncms restore /srv/backups/yuncms-2026-08-22 --yes
```

The recorded database target must match the current host/port/database unless the operator explicitly uses:

```bash
yuncms restore /srv/backups/yuncms-2026-08-22 --yes --allow-different-database-target
```

Restore resets current tables/views first, then imports the dump and restores project assets. This prevents tables created only by a failed migration from surviving an old dump import.

### `yuncms update`

Inspect without modifying project state:

```bash
yuncms update --dry-run
```

Update to the latest published release:

```bash
yuncms update
```

Pin an exact/registry-resolvable release:

```bash
yuncms update --to 0.2.0
```

The managed update flow requires project `package.json` to declare `@yunsoft/yuncms`. It performs target-package/migration preflight, requires the service to be stopped, creates a mandatory verified backup, installs the target package, runs the **newly installed** CLI's bootstrap, launches a temporary runtime, requires `/ready`, and then stops that verification runtime.

If installation, migration or readiness verification fails after backup creation, YunCMS attempts to restore the database/project snapshot, reinstall the old dependency graph and verify the restored runtime. A rollback failure is surfaced as `UPDATE_ROLLBACK_FAILED` and the backup is preserved.

There is no `--no-backup` update mode.

S3 installations require explicit acknowledgement after provider-side recovery has been verified:

```bash
yuncms update --to 0.2.0 --allow-unverified-s3
```

Read [Production upgrades](upgrades.md) before using this in production.

### `yuncms help`

Advertises the implemented `init`, `bootstrap`, `start`, `backup`, `restore`, `update` and help commands.

## Local workspace forms

During repository development the equivalent root/workspace scripts can be used. The public package-level target remains:

```text
npx yuncms init
npx yuncms bootstrap
npx yuncms start
npx yuncms backup
npx yuncms update --dry-run
```

Real registry, MySQL, `mysqldump`/`mysql`, process-supervisor and rollback smoke tests are environment-dependent release gates. They must be verified before calling a release production-upgrade tested.

## Environment

`.env.example` documents the current runtime variables for:

- API host/port/Studio origin;
- MySQL;
- local/S3 storage;
- SMTP;
- authentication rate limits;
- audit cleanup defaults;
- logging.

The init env writer escapes values and rejects newline/null-byte content before writing secrets.
