# YunCMS CLI

This document describes CLI behavior implemented on branch `16-08-2026`.

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

`bootstrap` does not create the first admin; use interactive `init` for that current workflow.

### `yuncms start`

```bash
yuncms start
```

The CLI resolves the installed `@yunsoft/yuncms-api` server entry and spawns it with the caller's current working directory and environment. This keeps project `.env`, extension discovery and relative local-storage paths rooted in the user's project rather than the CLI package directory.

Signals are forwarded to the API child so the API can run its graceful HTTP/MySQL shutdown path.

### `yuncms help`

Advertises the implemented `init`, `bootstrap`, `start` and help commands.

## Local workspace forms

During repository development the equivalent root/workspace scripts can be used. The public package-level target remains:

```text
npx yuncms init
npx yuncms bootstrap
npx yuncms start
```

The public `@yunsoft/yuncms` package and its dependencies were verified with `npm pack`, a clean registry install and real `init`/`bootstrap`/`start` smoke tests for `0.1.0`.

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
