# REST API

This document describes REST behavior implemented on branch `16-08-2026`. Schema-management REST endpoints are not shipped yet.

## Response/error shape

Successful collection reads return:

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

Errors use:

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

Known client/auth errors map to stable 400/401/403/404/409 responses. Unexpected server errors return a generic message rather than exposing the original internal exception text. The server logs the original exception with the request id.

## Authentication

Application routes accept Bearer access tokens and static API tokens. Refresh tokens are only accepted by the refresh endpoint and are not valid application Bearer credentials.

Requests without a Bearer credential use the configured public role when one exists; no public role means explicit public accountability with `role = null`, which fails closed in permission-controlled services.

Implemented auth routes:

```text
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
POST   /auth/logout-all
GET    /auth/tokens
POST   /auth/tokens
DELETE /auth/tokens/:id
```

See `docs/auth.md` for token/session details.

## Items routes

Implemented routes:

```text
GET    /items/:collection
GET    /items/:collection/:id
POST   /items/:collection
PATCH  /items/:collection/:id
DELETE /items/:collection/:id
```

HTTP routes are deliberately thin adapters around `ItemsService`; authentication produces accountability, while authorization, field restrictions, row filters and SQL compilation live in core services.

### Collection query

Current query parameters:

- `fields`: comma-separated field names or an array when called directly through `ItemsService`;
- `filter`: JSON object/string using the allowed operators below;
- `sort`: comma-separated fields, prefix descending fields with `-`;
- `limit`: integer, default 100, current hard maximum 500;
- `offset`: non-negative integer.

Allowed filter operators:

- `_eq`, `_neq`
- `_lt`, `_lte`, `_gt`, `_gte`
- `_in`, `_nin`
- `_null`, `_nnull`
- `_contains`, `_starts_with`, `_ends_with`
- `_and`, `_or`

Unknown query parameters, fields and operators fail closed. Values use MySQL placeholders.

Example filter value after URL decoding:

```json
{
  "status": { "_eq": "active" },
  "amount": { "_gte": 100 }
}
```

## Permission behavior

`ItemsService` resolves `create/read/update/delete` permissions from the active accountability role.

- explicit admin/system accountability bypasses ordinary permission rows;
- role-less public accountability is denied;
- a configured public role can receive explicit collection/action permission rows;
- missing permission row is denied;
- permission field allowlists restrict selectable, sortable, filterable and writable fields;
- permission row filters are compiled server-side and ANDed with user filters;
- user filters/sorts cannot reference fields hidden by the permission field allowlist;
- bulk service update/delete require an explicit non-empty caller filter in addition to any permission filter.

Session/API-token authentication resolves the owning user's current role before `ItemsService` executes, so the same service authorization path is used for HTTP and future extension calls.

## Health endpoints

```text
GET /health
GET /ready
```

Both probes run before authentication middleware. `/health` reports process/API health without performing role lookup. `/ready` checks MySQL readiness and returns 503 when the DB ping fails.

## Not implemented yet

- password-reset and email-verification routes;
- relation expansion;
- bulk REST create/update/delete routes;
- schema-management REST routes;
- permission validation-rule enforcement;
- API rate limiting.
