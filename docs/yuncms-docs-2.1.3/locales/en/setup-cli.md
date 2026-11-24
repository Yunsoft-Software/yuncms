# CLI, Configuration and Upgrades (YunCMS 2.1.3)

> **Published Version:** `YunCMS 2.1.3` · **Git Tag:** `v2.1.3` · **Commit:** `818019ea00312f3a0b465b5f99759d2e13021371`

This reference documents the CLI commands, core runtime environment variables, and backup/upgrade workflow shipped in **YunCMS 2.1.3**.

## CLI command reference

From a project where `@yunsoft/yuncms@2.1.3` is installed:

```bash
npx yuncms init
npx yuncms bootstrap
npx yuncms start
npx yuncms backup [--output /path/to/backup]
npx yuncms restore /path/to/backup --yes
npx yuncms update --dry-run
npx yuncms update --to <version>
npx yuncms help
```

| Command | Purpose |
| --- | --- |
| `init` | Interactive first-run setup: scaffolds project files, creates `.env`, verifies MySQL, runs migrations, and creates the initial Administrator once. |
| `bootstrap` | Non-interactive, environment-driven database bootstrap using an advisory lock; applies missing migrations and exits cleanly. |
| `start` | Starts the YunCMS `2.1.3` Express API and Studio listener using the current working directory as project root; forwards `SIGINT`/`SIGTERM` for graceful shutdown. |
| `backup` | Verifies the runtime is stopped, dumps MySQL via gzip, checks gzip integrity, and snapshots `.env`, package metadata, local `uploads/`, and `extensions/`. |
| `restore` | Destructively restores a verified backup snapshot (requires `--yes`; add `--allow-different-database-target` when intentionally restoring to a different DB target). |
| `update` | Inspects compatibility (`--dry-run`) or creates a mandatory backup, installs the target version, runs `bootstrap`, probes `/ready`, and rolls back on failure. |
| `help` | Prints implemented commands and project links. |

Process managers can also start the generated entry file directly:

```bash
node start.js
```

## Core `.env` configuration

### Server and reverse proxy

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` inside containers). |
| `PORT` | `3008` | Single-port listener shared by Studio and REST API. |
| `STUDIO_ORIGIN` | `http://localhost:3008` | Public Studio origin URL. |
| `AUTH_PUBLIC_URL` | `STUDIO_ORIGIN` | Public base URL used for auth links and automatic license-domain resolution on non-local HTTPS hosts. |
| `TRUST_PROXY_HOPS` | `0` | Exact number of trusted reverse-proxy hops (`0` when reached directly). |
| `LOG_LEVEL` | `info` | Structured JSON logger level. |

### MySQL database

| Variable | Default | Description |
| --- | --- | --- |
| `DB_HOST` | `127.0.0.1` | MySQL host. |
| `DB_PORT` | `3306` | MySQL port. |
| `DB_DATABASE` | `yuncms` | Target MySQL database name. |
| `DB_USER` | `yuncms` | MySQL user. |
| `DB_PASSWORD` | empty | MySQL password (keep outside version control). |
| `DB_CONNECTION_LIMIT` | `10` | `mysql2/promise` pool size. |
| `DB_SSL` | `false` | Enables MySQL TLS connection when `true`. |

### Files, Redis, SMTP and authentication

| Area | Key variables |
| --- | --- |
| Local Files | `FILES_LOCAL_ROOT` (`uploads`), `FILES_MAX_UPLOAD_BYTES` (`26214400`) |
| S3-compatible Files | `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` |
| Shared state (multi-replica) | `CACHE_STORE`, `API_RATE_LIMIT_STORE`, `AUTH_RATE_LIMIT_STORE` (`memory` or `redis`), `REDIS_URL`, `REDIS_PREFIX`, `REDIS_REQUIRED` |
| SMTP email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` |
| Two-factor auth (TOTP) | `AUTH_TOTP_KEY` (32-byte hex key; keep stable and backed up privately) |
| External SSO | `AUTH_PROVIDERS`, `AUTH_STATE_SECRET`, `AUTH_PROVIDER_<ID>_*` (`oidc`, `oauth2`, `ldap`, `saml`) |
| Flows safety | `FLOWS_REQUEST_ALLOWED_HOSTS`, `FLOWS_ENV_ALLOW_LIST`, `FLOWS_SCRIPTS_ENABLED`, `FLOWS_SCRIPT_TIMEOUT_MS`, `FLOWS_SCRIPT_MEMORY_MB` |
| Licensing & feature gates | `YUNCMS_LICENSE_PUBLIC_KEY`, `YUNCMS_LICENSE_DOMAIN`, `YUNCMS_LICENSE_INSTANCE_ID`, `YUNCMS_LICENSE_TOKEN`, `YUNCMS_FEATURES_DISABLED` |

## Safe backup and upgrade workflow

1. Stop the production process supervisor before creating a backup or running a managed update.
2. Run `npx yuncms backup` to produce a verified database and project snapshot (S3 buckets must be backed up separately at the provider).
3. Inspect updates with `npx yuncms update --dry-run` before running `npx yuncms update --to <target-version>`.
4. For Docker deployments, back up MySQL and `/data`, pin the target image tag in `.env`, run `docker compose run --rm yuncms bootstrap`, and restart `yuncms`.

Continue to [Using YunCMS Studio (YunCMS 2.1.3)](doc:studio-guide) or [Features, Licensing and Production Operations (YunCMS 2.1.3)](doc:licensing-and-operations).
