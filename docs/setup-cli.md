# YunCMS CLI

This document describes only CLI behavior currently implemented on branch `16-08-2026`.

## Runtime requirement

The CLI currently accepts Node.js 24.x only. Unsupported major versions fail with `UNSUPPORTED_NODE_VERSION` before command execution.

## Commands

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

1. loads the same environment configuration used by the API;
2. creates the MySQL pool;
3. runs `SELECT 1` connectivity validation;
4. obtains the bootstrap advisory lock;
5. applies required core migrations;
6. prints newly applied migration IDs, or reports that the DB was already bootstrapped;
7. prints the current schema version;
8. closes the pool even when bootstrap fails.

The command does not create the first administrator yet. That belongs to the auth/interactive-init milestone.

### `yuncms help`

Prints the currently available command surface. The help text explicitly labels `init` and the CLI `start` wrapper as planned rather than shipped.

## Environment

The bootstrap command uses the current core config variables from `.env.example`, including:

- `DB_HOST`
- `DB_PORT`
- `DB_DATABASE`
- `DB_USER`
- `DB_PASSWORD`
- `DB_CONNECTION_LIMIT`
- `DB_SSL`

The current code reads process environment variables; automatic `.env` file creation/loading is part of the future interactive `init` wizard and is not implemented yet.

## Planned setup wizard

The intended future experience remains:

```text
npx yuncms init
npx yuncms bootstrap
npx yuncms start
```

`init` will collect/test MySQL configuration, write environment configuration without echoing secrets, bootstrap the database and create the first administrator exactly once. These steps remain unchecked in `plan.md` until implemented.
