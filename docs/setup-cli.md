# YunCMS Setup and CLI

YunCMS is distributed through npm as `@yunsoft/yuncms`. Normal users do **not** need to clone or fork the source repository.

## Requirements

- Node.js 24 LTS
- npm 11+
- MySQL 8-compatible server

The CLI accepts Node.js 24.x only. Unsupported major versions fail before command execution.

## Fastest installation: run from npm with `npx`

Create a directory for the installation and run the published package directly:

```bash
mkdir my-yuncms
cd my-yuncms
npx --yes @yunsoft/yuncms init
```

Then start YunCMS:

```bash
npx --yes @yunsoft/yuncms start
```

Open:

```text
http://localhost:3008
```

The same port serves both Studio and the REST API.

`npx` downloads the npm package when it is not already available locally and executes its `yuncms` binary. The YunCMS process still uses your current directory as the project directory; `.env`, local Files and local `extensions/` are therefore kept in your project directory, not in the npm cache.

### What `init` does

`init` is interactive. It:

1. validates Node.js 24;
2. creates `.env` when one does not already exist;
3. asks for MySQL host, port, database, username, password and TLS preference;
4. writes `.env` with restrictive permissions where supported;
5. verifies MySQL connectivity;
6. applies missing core database migrations;
7. checks whether an Administrator already exists;
8. asks for the first Administrator email/password when needed;
9. creates that Administrator exactly once;
10. prints the API and Studio addresses.

Rerunning `init` reuses the existing `.env`, safely checks migrations again and does not silently create another initial Administrator.

## Recommended long-lived installation

The direct remote `npx` form is useful for first setup and evaluation. For a persistent server, record YunCMS in the project's own `package.json` so the installed version is explicit and the managed update command can operate on the project dependency.

From the YunCMS project directory:

```bash
npm init -y
npm install @yunsoft/yuncms
npx yuncms init
npx yuncms start
```

After that installation, use the shorter local form:

```bash
npx yuncms <command>
```

`npx yuncms` resolves the binary from the project's installed `@yunsoft/yuncms` dependency.

## Commands

### `init`

Remote package form:

```bash
npx --yes @yunsoft/yuncms init
```

Locally installed package form:

```bash
npx yuncms init
```

Use this for the first interactive database and Administrator setup.

### `bootstrap`

```bash
npx yuncms bootstrap
```

Runs non-interactive, environment-driven database bootstrap. It validates connectivity, obtains the bootstrap advisory lock, applies missing core migrations, reports the schema version and closes the database pool on completion.

`bootstrap` does not create the first Administrator. Use `init` for the initial interactive setup.

### `start`

```bash
npx yuncms start
```

Starts the installed YunCMS API package using the current directory as the project root. That means project `.env`, local storage and local extension discovery are resolved from the directory where the command is executed.

Signals are forwarded to the API process so graceful HTTP/MySQL shutdown can run normally.

### `backup`

Stop the normal service supervisor first, then run:

```bash
npx yuncms backup
```

Optional destination:

```bash
npx yuncms backup --output /srv/backups/yuncms-2026-08-25
```

The command refuses to create its normal consistent snapshot while the configured local YunCMS health endpoint is reachable. It:

- streams `mysqldump` through gzip;
- verifies the gzip stream;
- snapshots `.env`;
- snapshots project package metadata;
- snapshots local uploads;
- snapshots local `extensions/` when present.

S3 objects are not copied by this command. Use provider-side versioning/snapshots or another verified S3 backup method.

### `restore`

Restore is destructive and requires explicit confirmation:

```bash
npx yuncms restore /srv/backups/yuncms-2026-08-25 --yes
```

By default the recorded database host/port/database must match the current target. To intentionally restore to a different database target:

```bash
npx yuncms restore /srv/backups/yuncms-2026-08-25 --yes --allow-different-database-target
```

Restore resets current tables/views before importing the saved database, then restores project assets.

If package files were restored, synchronize dependencies before starting YunCMS:

```bash
npm ci
```

when `package-lock.json` exists, otherwise:

```bash
npm install
```

### `update`

Managed update is intended for a persistent installation whose `package.json` declares `@yunsoft/yuncms`.

Inspect the target without changing project state:

```bash
npx yuncms update --dry-run
```

Update to the latest registry release:

```bash
npx yuncms update
```

Update to a specific version:

```bash
npx yuncms update --to 0.2.0
```

The managed update flow:

1. inspects the target package and migration compatibility;
2. requires the normal service supervisor to be stopped;
3. creates a mandatory verified backup;
4. installs the target npm package;
5. runs the newly installed CLI's database bootstrap;
6. starts a temporary runtime;
7. requires `/ready` to pass;
8. stops the temporary verification runtime.

If a post-backup installation, migration or readiness step fails, YunCMS attempts to restore the database/project snapshot, reinstall the old dependency graph and verify the restored runtime.

There is no `--no-backup` managed update mode.

For S3-backed installations, provider-side recovery must be verified separately. Read [Upgrades / Backup / Restore](upgrades.md) before production updates.

### `help`

```bash
npx yuncms help
```

Lists the implemented commands and options.

## Which command form should I use?

For a first run without installing anything into the project:

```bash
npx --yes @yunsoft/yuncms init
npx --yes @yunsoft/yuncms start
```

For a normal persistent installation after `npm install @yunsoft/yuncms`:

```bash
npx yuncms init
npx yuncms start
npx yuncms backup
npx yuncms update --dry-run
```

The source repository is only needed when you intend to develop YunCMS itself or contribute code. It is not part of the normal installation path.

## Environment configuration

`.env.example` and [Configuration](configuration.md) document the current runtime variables for:

- API host/port and Studio origin;
- MySQL;
- Redis and cache/rate-limit stores;
- local and S3-compatible Files storage;
- SMTP;
- external authentication providers;
- logging and operational limits.

MCP and the built-in AI assistant are configured after sign-in through their Administrator settings screens in Studio.

The init env writer rejects newline/null-byte content before writing secrets.
