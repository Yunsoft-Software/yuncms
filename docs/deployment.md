# Deployment Baseline

YunCMS V1 targets Node.js 24 LTS with MySQL 8-compatible servers.

## Runtime

Required:

- Node.js 24 LTS;
- npm workspace install / reviewed lockfile;
- MySQL database/user;
- writable local storage directory or configured S3-compatible bucket;
- optional SMTP for password reset/email verification.

The API should run behind a production reverse proxy/TLS terminator when exposed to the internet.

## Startup sequence

Recommended deployment flow:

```text
1. install package/dependencies
2. provide environment variables
3. yuncms bootstrap
4. yuncms start
5. serve/build Studio separately or from the chosen web deployment
```

`yuncms start` never silently bootstraps an outdated database. API startup checks required migrations before listening.

## Environment

Minimum DB example:

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

Use a least-privilege MySQL user scoped to the YunCMS database but able to perform the DDL required by dynamic schema operations.

See `.env.example` for file/S3/SMTP/rate-limit values.

## Local storage

`FILES_LOCAL_ROOT` must be on persistent storage with permissions restricted to the YunCMS process identity. Do not use an ephemeral container filesystem unless losing uploads is acceptable.

When horizontally scaling multiple API instances, local storage is not shared automatically. Use a shared/persistent filesystem or S3-compatible driver.

## S3-compatible storage

Set `S3_BUCKET` to register the `s3` driver. `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE` support compatible providers that do not use default AWS endpoint/addressing behavior.

Before production, verify the exact provider listed in `todo.md` rather than assuming AWS-S3 compatibility implies identical behavior.

## SMTP

If SMTP delivery is configured, `SMTP_HOST` and `SMTP_FROM` are both required. Temporary SMTP unavailability does not prevent the API from starting; recovery/verification delivery fails independently.

## Multi-instance considerations

Shared MySQL is supported by schema advisory locking for intentional dynamic-schema mutations.

Still consider:

- per-instance DB pool sizing;
- shared S3/storage;
- process-local auth rate limits are not cluster-wide;
- in-memory schema/permission request caches are local to each process;
- extension code runs in-process and must be trusted;
- graceful deployment should allow active requests to drain before force termination.

A future shared rate-limit/cache store may be useful at larger scale, but YunCMS V1 does not require Redis to run.

## Backups

Back up both:

- the MySQL database;
- file storage objects.

Dynamic collection tables and `yuncms_*` metadata must be restored consistently. Do not restore metadata alone without the corresponding physical collection tables/files.

## Observability

Runtime logs are structured JSON. Preserve request ids in reverse-proxy/application logs so API errors and audit records can be correlated.

Monitor at minimum:

- API process restarts;
- `/ready` failures;
- MySQL connection/lock errors;
- `SCHEMA_PARTIAL_FAILURE`;
- `FILE_STORAGE_CLEANUP_FAILED`;
- audit-write failures;
- auth rate-limit spikes;
- extension startup failures.

## Release gate

Do not call a deployment production-ready solely because source code exists. Before release, complete the relevant `todo.md` items for:

- dependency install/lockfile/build;
- bootstrap idempotency;
- real-MySQL schema/CRUD/RBAC/auth integration;
- Studio smoke path;
- local/S3 file behavior;
- SMTP recovery/verification;
- concurrency/graceful shutdown;
- npm package/tarball installation.
