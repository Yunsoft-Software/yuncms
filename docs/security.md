# Security Model

YunCMS V1 is designed around explicit accountability and service-layer authorization.

## Identity/accountability

Every service call must receive explicit accountability. `null` does not mean administrator.

Supported identities:

- authenticated user + role;
- administrator role;
- explicit public role/role-less public identity;
- explicit internal system accountability.

HTTP routes authenticate first, then instantiate services with that same accountability. Trusted extensions receive the same request/service context and should call services directly rather than self-requesting HTTP.

## Authorization

`ItemsService` enforces:

- action permission (`create/read/update/delete`);
- field allowlists;
- server-side row filters;
- prospective-record validation rules on create/update;
- fail-closed behavior when role/permission is missing.

Schema services require administrator/system accountability. Files are administrator/system-only in V1. User/role/permission management is administrator/system-controlled with self-admin protections.

Effective permission results are cached only inside the current request, avoiding long-lived cross-process stale permission caches.

## SQL safety

- MySQL only through `mysql2/promise`;
- multi-statements disabled;
- data values use placeholders;
- dynamic identifiers use allowlisted identifier validation/quoting;
- query/filter operators are explicitly allowlisted;
- collection/field names resolve against trusted schema metadata before generic item SQL is built.

## Dynamic schema safety

Schema mutations use a MySQL advisory lock and a schema version.

Because MySQL DDL is not treated as ordinary rollbackable application DML, schema services use compensation/tombstone strategies where practical:

- create cleanup after metadata failure;
- collection/field destructive-delete tombstones;
- M2O FK restoration/removal compensation;
- M2M junction tombstone lifecycle;
- metadata + schema-version transaction discipline.

Destructive collection/field/M2M deletion requires explicit intent.

## Authentication

- passwords use Node `crypto.scrypt` with random salts;
- opaque credentials are stored as hashes;
- refresh credentials rotate;
- password changes revoke sessions;
- reset/verification tokens are one-time and hashed in storage;
- public recovery request does not return raw action tokens;
- login/account recovery avoids intentional account-existence disclosure;
- authentication-sensitive endpoints have process-local rate limits.

For multi-instance deployments, process-local rate limiting is not a cluster-wide protection. Use a shared limiter before relying on one global budget.

## Mail

SMTP message construction disables Nodemailer file and URL access. Reset/verification links use `AUTH_PUBLIC_URL`.

Do not place tokens/passwords in logs. The runtime structured logger and audit redactor recursively redact common secret key names.

## Files

- physical keys are generated UUIDs, not user filenames;
- local storage rejects path traversal/path separators;
- upload body size is bounded;
- S3-compatible access is through the official SDK client;
- cleanup failure is surfaced instead of silently hiding an orphan.

## Extensions

V1 extensions are trusted server-side code. They can receive DB/services/storage context and execute in the API process.

Do not install untrusted extension packages. Marketplace sandbox/process/capability isolation is intentionally outside V1.

## HTTP/runtime

API responses include request ids and basic headers:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- restrictive `Permissions-Policy`

CORS only reflects the configured Studio origin.

## Logging/audit

Runtime logs are line-delimited structured JSON and redact sensitive key names such as password/token/secret/authorization/api-key/credential.

Audit records actor/action/collection/item/request id/timestamp and redacted payload for item/file lifecycle and schema admin mutations.

Audit write failure after a committed mutation is logged rather than turning a successful committed mutation into a misleading client failure.

## Production checks still requiring execution

Source-level controls are not a substitute for runtime verification. `todo.md` keeps the real MySQL, SMTP, S3, concurrency, auth replay, role isolation, path traversal, logging-redaction and graceful-shutdown checks that must be executed before production release.
