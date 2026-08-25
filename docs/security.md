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

Effective permissions are cached only inside the current request.

Direct M2O expansion does not bypass RBAC: the source relation field must be readable and target rows are resolved through `ItemsService` with the same accountability, target row filters and target field allowlists.

Schema services and file/maintenance administration require admin/system accountability. User/role/permission management includes current-admin/protected-role guards.

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
- login/refresh/action endpoints use process-local rate limits;
- all `/auth/*` responses are marked `Cache-Control: no-store`.

Process-local limits are not cluster-wide protection. Multi-instance deployments must add a shared limiter if one global budget is required.

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

HSTS is intentionally configured at the real TLS/reverse-proxy layer rather than forced by an application that does not know whether it is directly serving HTTPS.

## Logging/audit

Runtime logs are line-delimited structured JSON and recursively redact password/token/secret/authorization/api-key/credential-shaped keys.

Audit records actor/action/collection/item/request id/timestamp plus redacted payload for item/file/schema mutations.

Audit write failure after a committed mutation is logged rather than converting the already-committed operation into a misleading client failure.

Retention cleanup is explicit, admin-only and batched. Retention environment defaults do not trigger surprise automatic deletion.

## Production verification

Source controls are not a substitute for execution. Complete the real MySQL, SMTP, S3/reconciliation, auth replay, RBAC/validation, relation expansion, concurrency, logging-redaction, security-header and graceful-shutdown checks in [Production Readiness](production-readiness.md) before exposing a deployment.
