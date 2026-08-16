# Deployment Baseline

YunCMS V1 targets Node.js 24 LTS with a MySQL 8-compatible server.

## Required runtime pieces

- Node.js 24 LTS;
- reviewed npm install/lockfile;
- MySQL database/user;
- persistent local storage or configured S3-compatible bucket;
- optional SMTP for password reset/email verification.

Expose the API through a production reverse proxy/TLS terminator when internet-facing.

## Startup flow

```text
1. install dependencies/package
2. provide environment variables
3. yuncms bootstrap
4. yuncms start
5. serve the built Studio separately/from the chosen web deployment
```

`yuncms start` does not silently migrate an outdated DB. Startup checks required migrations before listening.

## Environment

Minimal DB/API example:

```text
HOST=127.0.0.1
PORT=8055
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=yuncms
DB_USER=yuncms
DB_PASSWORD=...
DB_CONNECTION_LIMIT=10
DB_SSL=false
STUDIO_ORIGIN=https://studio.example.com
```

Use a least-privilege MySQL user scoped to the YunCMS database but able to perform the DDL required by the dynamic schema engine.

`.env.example` also documents local/S3 storage, SMTP, auth rate limits, audit cleanup defaults and logging.

## Local storage

`FILES_LOCAL_ROOT` must be persistent and writable only by the intended YunCMS runtime identity.

When multiple API instances run, local disks are not shared automatically. Use shared persistent storage or S3-compatible storage.

## S3-compatible storage

Set `S3_BUCKET` to register the `s3` driver. Custom endpoint/path-style settings support providers such as self-hosted S3-compatible services.

Verify the exact production provider from `todo.md`; compatibility claims should not replace real provider testing.

## File reconciliation

`POST /files/reconcile` is an admin maintenance operation.

Recommended operational practice:

1. run dry-run first;
2. investigate missing storage objects separately;
3. only use `deleteOrphans:true` after reviewing the report;
4. keep an age guard large enough to avoid racing in-flight uploads;
5. keep backups independent from reconciliation.

The service never automatically deletes DB metadata merely because the storage object is missing.

## SMTP

If SMTP is configured, `SMTP_HOST` and `SMTP_FROM` are required together. Temporary SMTP unavailability does not stop the whole API from starting.

## Audit retention

Defaults:

```text
AUDIT_RETENTION_DAYS=90
AUDIT_CLEANUP_BATCH_SIZE=1000
AUDIT_CLEANUP_MAX_BATCHES=100
```

These values configure an explicit cleanup request; they do **not** schedule automatic deletion.

Run `POST /audit/cleanup` from an authenticated administrator/operator workflow when retention cleanup is desired. Cleanup uses bounded batches so one request does not attempt an unbounded table delete.

## Multi-instance considerations

Shared MySQL schema mutation is serialized through advisory locks, but multi-instance deployments must still consider:

- DB pool sizing per instance;
- shared file storage;
- process-local auth rate limits are not one cluster-wide budget;
- request/schema caches are process-local;
- trusted extension code executes in each API process;
- graceful deployment/draining before force termination.

Redis/shared rate-limit infrastructure is not required for a single-process V1, but may become necessary when horizontally scaling authentication traffic.

## TLS and HTTP headers

The API applies baseline application headers and narrow Studio CORS. Configure at the real reverse proxy/TLS layer:

- HTTPS certificates;
- HTTP-to-HTTPS redirect;
- HSTS once HTTPS is guaranteed;
- trusted proxy/client IP behavior as appropriate;
- body/request limits consistent with `FILES_MAX_UPLOAD_BYTES`.

## Backups

Back up both:

- MySQL, including dynamic collection tables and `yuncms_*` metadata;
- file storage objects.

Restore DB metadata, physical dynamic tables and file objects consistently.

## Observability

Runtime logs are structured JSON. Preserve/request-log `X-Request-Id` so API errors and audit records can be correlated.

Monitor at minimum:

- process restarts;
- `/ready` failures;
- DB connection/lock/deadlock errors;
- `SCHEMA_PARTIAL_FAILURE`;
- `FILE_STORAGE_CLEANUP_FAILED`;
- reconciliation drift counts;
- audit-write/cleanup failures;
- auth rate-limit spikes;
- extension startup failures.

## Release gate

Do not call a deployment production-ready because source code exists. Complete applicable `todo.md` checks for:

- dependency install/lockfile/tests/build;
- bootstrap idempotency;
- real MySQL schema/CRUD/relation/RBAC/auth behavior;
- Studio smoke/accessibility;
- local/S3 file behavior + reconciliation;
- SMTP recovery/verification;
- audit cleanup/logging/security headers;
- concurrency/graceful shutdown;
- npm naming/tarball/fresh-install flow.
