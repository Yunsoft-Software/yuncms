# REST API

This document describes REST behavior implemented on branch `16-08-2026`.

## Response and error shape

Collection reads return `data` plus pagination metadata:

```json
{
  "data": [],
  "meta": {
    "total_count": 0,
    "limit": 100,
    "offset": 0
  }
}
```

Errors use the canonical form:

```json
{
  "errors": [
    {
      "code": "INVALID_QUERY",
      "message": "Unknown field: secret",
      "path": "filter.secret",
      "request_id": "..."
    }
  ]
}
```

Known client/auth/schema conflicts map to stable 4xx responses. Retryable infrastructure failures map to 503. Unexpected server errors return a generic message; the structured server log retains the internal error with the request id after secret redaction.

## Authentication

Application routes accept Bearer access tokens and static API tokens. Refresh/reset/verification tokens are accepted only by their dedicated endpoints.

Implemented auth routes:

```text
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
POST   /auth/logout-all
POST   /auth/password-reset/request
POST   /auth/password-reset/confirm
POST   /auth/email-verification/request
POST   /auth/email-verification/confirm
GET    /auth/tokens
POST   /auth/tokens
DELETE /auth/tokens/:id
```

Login, refresh and action-token endpoints use configurable process-local fixed-window rate limits. See `docs/auth.md` for token/session and SMTP behavior.

## Items

```text
GET    /items/:collection
GET    /items/:collection/:id
POST   /items/:collection
PATCH  /items/:collection/:id
DELETE /items/:collection/:id
```

Current collection query parameters:

- `fields`
- `filter`
- `sort`
- `limit`
- `offset`
- `expand`

Allowed filter operators:

- `_eq`, `_neq`
- `_lt`, `_lte`, `_gt`, `_gte`
- `_in`, `_nin`
- `_null`, `_nnull`
- `_contains`, `_starts_with`, `_ends_with`
- `_and`, `_or`

Unknown fields/operators/parameters fail closed. SQL values remain placeholders.

### Direct relation expansion

V1 supports one-level direct M2O expansion:

```text
GET /items/articles?fields=id,title&expand=author_id
GET /items/articles/<id>?expand=author_id
```

The FK field is replaced with the readable target record:

```json
{
  "id": "...",
  "title": "Example",
  "author_id": {
    "id": "...",
    "name": "Ada"
  }
}
```

Rules:

- at most eight direct relation fields may be expanded per request;
- the source relation field must be readable under the source collection permission;
- target rows are loaded through `ItemsService` with the same accountability and request-local permission cache;
- target row filters and field allowlists therefore still apply;
- inaccessible target rows become `null` rather than bypassing target permissions;
- M2M/O2M nested expansion is not implemented in V1.

## Schema administration

Schema services require administrator/system accountability.

Collections:

```text
GET    /schema/collections
POST   /schema/collections
GET    /schema/collections/:collection
PATCH  /schema/collections/:collection
DELETE /schema/collections/:collection?destructive=true
```

Fields:

```text
GET    /schema/collections/:collection/fields
POST   /schema/collections/:collection/fields
GET    /schema/collections/:collection/fields/:field
PATCH  /schema/collections/:collection/fields/:field
PATCH  /schema/collections/:collection/fields/:field/schema
DELETE /schema/collections/:collection/fields/:field?destructive=true
```

Relations:

```text
GET    /schema/relations
GET    /schema/relations/:manyCollection/:manyField
GET    /schema/collections/:collection/relations/o2m
POST   /schema/relations/m2o
DELETE /schema/relations/m2o/:manyCollection/:manyField
POST   /schema/relations/m2m
DELETE /schema/relations/m2m/:junctionCollection?destructive=true
```

Destructive collection, field and M2M deletion never infer intent from the HTTP verb alone; the explicit destructive flag is required.

## Users, roles and permissions

```text
GET    /users
POST   /users
GET    /users/:id
PATCH  /users/:id
DELETE /users/:id

GET    /roles
POST   /roles
GET    /roles/:id
PATCH  /roles/:id
DELETE /roles/:id

GET    /permissions
POST   /permissions
GET    /permissions/:id
PATCH  /permissions/:id
DELETE /permissions/:id
```

Permissions support field allowlists, row filters and create/update prospective-record validation JSON. All enforcement lives in core services rather than route-only checks.

## Files

```text
GET    /files
POST   /files
POST   /files/reconcile
GET    /files/:id
GET    /files/:id/content
PATCH  /files/:id
DELETE /files/:id
```

`POST /files/reconcile` is administrator-only. It compares DB metadata with the selected storage inventory. Default behavior is dry-run. `deleteOrphans: true` only deletes orphan objects older than the configured/requested age guard; recent/unknown-age objects are not deleted.

Example:

```json
{
  "storage": "local",
  "deleteOrphans": false,
  "minimumAgeMs": 3600000
}
```

## Audit

```text
GET  /audit
POST /audit/cleanup
```

Audit reads and cleanup require administrator/system accountability. Cleanup runs in bounded DELETE batches and is never automatic merely because retention configuration exists.

Optional cleanup body:

```json
{
  "retentionDays": 90,
  "batchSize": 1000,
  "maxBatches": 100
}
```

## Health

```text
GET /health
GET /ready
```

Both probes run before authentication. `/health` reports process health; `/ready` also checks MySQL.

## HTTP hardening

The API disables `X-Powered-By`, emits request ids, applies a narrow configured Studio CORS origin and sets baseline `nosniff`, frame-deny, no-referrer, restrictive permissions-policy and same-origin resource-policy headers. HSTS is intentionally left to deployment/TLS configuration rather than being forced without proxy knowledge.

## Deliberate V1 limits

- no GraphQL;
- no bulk REST mutation endpoints even though bulk service methods exist;
- no nested O2M/M2M expansion;
- no untrusted extension sandbox;
- no automatic audit cleanup scheduler.
