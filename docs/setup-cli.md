# YunCMS CLI

This document describes only CLI behavior currently implemented on branch `16-08-2026`.

## Runtime requirement

The CLI currently accepts Node.js 24.x only. Unsupported major versions fail with `UNSUPPORTED_NODE_VERSION` before command execution.

The CLI/API load `.env` through the Node.js runtime before resolving YunCMS configuration. No `dotenv` dependency is required.

## Commands

### `yuncms init`

Local workspace form:

```bash
npm run init
```

The interactive wizard currently:

1. checks the Node.js major version;
2. if `.env` does not exist, asks for MySQL host/port/database/user/password/TLS;
3. masks MySQL/admin passwords on an interactive TTY;
4. validates configuration and writes `.env` once with file mode `0600`;
5. connects to MySQL and verifies `SELECT 1`;
6. bootstraps required core migrations;
7. detects whether an administrator already exists;
8. if needed, asks for administrator email/password + confirmation;
9. creates/reuses the administrator role and creates the first administrator exactly once;
10. prints the API and Studio URLs.

The wizard does not overwrite an existing `.env`.

If setup stops after `.env` creation, rerunning `yuncms init` reuses the existing file and continues database/bootstrap/admin checks. If an administrator already exists, the wizard does not silently create another one or ask for a replacement password.

Secret prompts require an interactive TTY. Non-interactive deployment should use environment configuration and `yuncms bootstrap`; automated first-admin provisioning remains future work.

### `yuncms bootstrap`

Local workspace form:

```bash
npm run bootstrap
```

Package/bin form after dependencies are installed:

```bash
yuncms bootstrap
```

The command:

1. loads `.env`/process environment configuration;
2. creates the MySQL pool;
3. runs `SELECT 1` connectivity validation;
4. obtains the bootstrap advisory lock;
5. applies required core migrations;
6. prints newly applied migration IDs, or reports that the DB was already bootstrapped;
7. prints the current schema version;
8. closes the pool even when bootstrap fails.

The bootstrap command itself does not create an administrator. Use `init` for the current interactive first-admin flow.

### `yuncms help`

Prints the currently available command surface. `init` and `bootstrap` are advertised as implemented; the CLI `start` wrapper remains explicitly marked as planned.

## Environment

Current configuration variables include:

- `HOST`
- `PORT`
- `STUDIO_ORIGIN`
- `DB_HOST`
- `DB_PORT`
- `DB_DATABASE`
- `DB_USER`
- `DB_PASSWORD`
- `DB_CONNECTION_LIMIT`
- `DB_SSL`

The environment writer quotes/escapes values and rejects newline/null-byte values before writing. The generated `.env` is opened with an exclusive-create flag so an existing configuration file is never overwritten by the wizard.

## Current/future install experience

The intended package-level experience remains:

```text
npx yuncms init
npx yuncms bootstrap
npx yuncms start
```

The `init` and `bootstrap` command implementations now exist inside the workspace package. Public npm package naming/publishing and the CLI `start` wrapper are still pending and remain unchecked in `plan.md`/`todo.md`.
