# Security Model

YunCMS V1 is designed around explicit accountability and service-layer authorization.

## Identity/accountability

Every service call receives explicit accountability. `null` never means administrator.

Supported identities:

- authenticated user + role;
- administrator role;
- explicit public role/role-less public identity;
- explicit internal system accountability.

HTTP authenticates first, then services receive the same accountability. Trusted extensions use service context directly instead of self-requesting YunCMS over HTTP.

## Authorization

`ItemsService` enforces:

- create/read/update/delete action permissions;
- field allowlists;
- server-side row filters;
- prospective-record create/update validation;
- fail-closed missing-role/missing-permission behavior.

Effective permission rules use the configured bounded memory or Redis cache; caller-dependent filter values are resolved for each service request. Native permission management invalidates the cache.

Direct M2O expansion does not bypass RBAC: the source relation field must be readable and target rows are resolved through `ItemsService` with the same accountability, target row filters and target field allowlists.

Dedicated native user/file references use the corresponding native services and explicit target read grants. Sensitive credential/storage fields remain unselectable. Non-null writes must reference a readable native target. Native FK DDL is limited to application tables, uses safe deletion rules and cannot modify protected system schemas.

Requests to protected system collections through the generic `/items` API return HTTP 403 `SYSTEM_COLLECTION_USE_DEDICATED_SERVICE`; use the corresponding native API.

Schema services and operational maintenance require admin/system accountability. Native Files operations support explicit delegated grants. User/role/permission management includes current-admin/protected-role guards.

## SQL safety

- MySQL only through `mysql2/promise`;
- multi-statements disabled;
- data values use placeholders;
- dynamic identifiers use validation/quoting;
- query/filter operators are allowlisted;
- generic collection/field inputs resolve against schema metadata.

## Dynamic schema safety

Schema mutation uses a MySQL advisory lock and schema version.

Because MySQL DDL is not treated as ordinary rollbackable application DML, current lifecycles use compensation/tombstones where practical:

- create cleanup after metadata failure;
- collection/field destructive-delete tombstones;
- M2O FK restoration/removal compensation;
- M2M junction tombstone lifecycle;
- metadata + schema-version transaction discipline.

Collection/field/M2M destructive deletion requires explicit intent.

## Authentication

- passwords use Node `crypto.scrypt` with random salts;
- opaque credentials are stored as hashes;
- refresh credentials rotate;
- password changes/reset revoke sessions;
- reset/verification tokens are one-time and hashed;
- public recovery request does not return action-token secrets;
- login/account recovery avoids intentional account-existence disclosure;
- login/refresh/action endpoints use bounded rate limits with the configured memory or Redis store;
- all `/auth/*` responses are marked `Cache-Control: no-store`.

Memory limits are process-local. Multi-instance deployments requiring one shared budget should configure the Redis auth/API limiter and its failure mode; see [Configuration](configuration.md).

## Mail

SMTP uses Nodemailer with file and URL message access disabled. Reset/verification links use `AUTH_PUBLIC_URL`.

Do not place tokens/passwords in logs. Structured logging and audit redaction recursively redact common secret key names.

## Files/storage

- physical keys are generated UUIDs, not user filenames;
- local storage rejects traversal/path separators and checks root containment;
- upload size is bounded;
- S3-compatible access uses AWS SDK v3;
- cleanup failures are surfaced explicitly;
- reconciliation defaults to dry-run;
- destructive orphan cleanup requires explicit intent plus an object-age guard;
- missing storage objects never cause automatic DB metadata deletion.
- native file update/delete enforce row filters in SQL; update field masks and prospective-record validation are checked before writing, and delete cannot touch storage outside its grant.

Reconciliation is an operational safety tool, not a replacement for storage backups/monitoring.

## Extensions

V1 extensions are trusted server-side code with service/database/storage access inside the API process.

Do not install untrusted extension packages. Untrusted sandbox/process/capability isolation is outside V1.

## HTTP/runtime

The API disables `X-Powered-By` and applies:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- restrictive `Permissions-Policy`
- `Cross-Origin-Resource-Policy: same-origin`

CORS reflects only the configured Studio origin.

Secure requests receive HSTS. Behind a TLS reverse proxy, configure the explicit trusted proxy hop count so the application can determine whether a request is secure, and restrict direct access to that proxy boundary.

## Logging/audit

Runtime logs are line-delimited structured JSON and recursively redact password/token/secret/authorization/api-key/credential-shaped keys.

Audit records actor/action/collection/item/request id/timestamp plus redacted payload for item/file/schema mutations.

Audit write failure after a committed mutation is logged rather than converting the already-committed operation into a misleading client failure.

Retention cleanup is explicit, admin-only and batched. Retention environment defaults do not trigger surprise automatic deletion.

API errors with status 500 or higher return a generic message and omit diagnostic `path` values, including filesystem paths. Safe client validation errors and typed extension 4xx errors may include a string field path and request id.

## Production verification

Source controls are not a substitute for execution. Complete the real MySQL, SMTP, S3/reconciliation, auth replay, RBAC/validation, relation expansion, concurrency, logging-redaction, security-header and graceful-shutdown checks in [Production Readiness](production-readiness.md) before exposing a deployment.

For container deployments, also run the per-architecture [OS package scan](docker.md#scan-operating-system-packages) against the deployed digest and review upstream Node.js/MySQL advisories. The Wolfi glibc runtime applies signed APK package updates and removes inherited SUID/SGID permissions. It retains the package database for inventory checks, the official Node.js 24/npm runtime and native MySQL 8.4 clients. Scanner results and deployment boundaries still need assessment.
