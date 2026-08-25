# REST API Reference

YunCMS exposes a REST API for dynamic collection data, schema administration, authentication, users, roles, permissions, Files, Studio settings, audit, AI/MCP integrations and installed endpoint extensions.

Default local origin:

```text
http://localhost:3008
```

Most authenticated endpoints use:

```http
Authorization: Bearer <access-token-or-api-token>
```

JSON writes use:

```http
Content-Type: application/json
```

Every response receives an `X-Request-Id`. A caller may provide a valid `X-Request-Id`; otherwise YunCMS creates one.

## Response shapes

Collection/list endpoints normally return:

```json
{
  "data": []
}
```

Items collection reads additionally include pagination metadata:

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

Single resources normally return:

```json
{
  "data": {
    "id": "..."
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

Known authentication, authorization, validation and schema conflicts map to 4xx responses. Capacity/shared-state failures can return 503. Unexpected server failures return a generic client-safe error while the request id remains available for log correlation.

# Health and readiness

```text
GET /health
GET /ready
```

`/health` confirms that the HTTP process is alive:

```json
{
  "status": "ok",
  "request_id": "..."
}
```

`/ready` also checks MySQL and any Redis instance configured as required shared state. A ready response reports the active cache/rate-limit stores:

```json
{
  "status": "ready",
  "request_id": "...",
  "shared_state": {
    "cache": "memory",
    "api_rate_limit": "memory",
    "auth_rate_limit": "memory"
  }
}
```

# Human labels and API keys

Collections and fields keep human-readable labels separate from stable machine identifiers.

```json
{
  "name": "Customer Requests",
  "collection": "customer_requests"
}
```

```json
{
  "name": "Sales Price",
  "field": "sales_price",
  "type": "decimal"
}
```

URLs, JSON property names, filters, sorting and relation paths always use the stable `collection` / `field` key. Changing a display name does not silently rename the underlying table, column or integration contract.

# Authentication

## Provider discovery

```text
GET /auth/providers
```

Returns public metadata for configured external authentication providers. An empty list is valid when only email/password authentication is configured.

## Email/password login

```text
POST /auth/login
```

```bash
curl 'http://localhost:3008/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"your-password"}'
```

The response contains an opaque access credential and refresh credential. See [`auth.md`](auth.md) for token lifetimes, rotation and revocation.

## External authentication

Browser-based providers use:

```text
GET  /auth/login/:provider
GET  /auth/callback/:provider
POST /auth/callback/:provider
POST /auth/exchange
```

The callback can be GET or POST depending on the configured provider protocol. Browser login finishes through a short-lived handoff code which Studio exchanges through `/auth/exchange`.

LDAP-style username/password providers use:

```text
POST /auth/login/:provider
```

## Refresh and logout

```text
POST /auth/refresh
POST /auth/logout
POST /auth/logout-all
```

`/auth/logout` and `/auth/logout-all` require a session access token, not a static API token.

## Public registration, password reset and email verification

```text
POST /auth/register
POST /auth/password-reset/request
POST /auth/password-reset/confirm
POST /auth/email-verification/request
POST /auth/email-verification/confirm
```

Password-reset request responses intentionally do not reveal whether an account exists.

Public registration is disabled by default, accepts only email/password credentials and assigns the Administrator-configured normal role. Email-verification resend responses are also non-enumerating. See [Public registration](public-registration.md).

## API tokens

```text
GET    /auth/tokens
POST   /auth/tokens
DELETE /auth/tokens/:id
```

The plaintext token is returned only when created. Stored/listed token data never exposes the secret or hash.

# Items: dynamic collection data

Every project collection is available at:

```text
GET    /items/:collection
GET    /items/:collection/:id
POST   /items/:collection
PATCH  /items/:collection/:id
DELETE /items/:collection/:id
```

All operations are evaluated through the active role/accountability. The generic Items API does not provide an unguarded path to internal system tables.

## Read a collection

```bash
curl --get 'http://localhost:3008/items/orders' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'fields=id,order_no,total,status,customer_id.name' \
  --data-urlencode 'filter={"status":{"_in":["paid","processing"]},"total":{"_gte":1000}}' \
  --data-urlencode 'search=acme' \
  --data-urlencode 'sort=-created_at,order_no' \
  --data-urlencode 'limit=25' \
  --data-urlencode 'offset=0'
```

Collection reads support:

- `fields` including `*`, `*.*` and nested relation projection;
- `filter` with comparison, list, null and text operators plus `_and`/`_or`;
- `search` across readable string/text fields;
- `sort` with multiple ascending/descending fields;
- `limit` / `offset` pagination;
- `aggregate` / `groupBy`;
- relation expansion using relation paths or `expand`.

The complete syntax, limits and examples are in [`api-query-language.md`](api-query-language.md).

## Read one

```bash
curl --get 'http://localhost:3008/items/articles/ARTICLE_ID' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'fields=id,title,author_id.name'
```

Single-record reads accept `fields` and `expand`.

## Create

```bash
curl 'http://localhost:3008/items/customer_requests' \
  -X POST \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"title":"New quote request","priority":7}'
```

Success returns HTTP 201 with the created record in `data`.

## Update

```bash
curl 'http://localhost:3008/items/customer_requests/RECORD_ID' \
  -X PATCH \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"status":"resolved"}'
```

## Delete

```bash
curl 'http://localhost:3008/items/customer_requests/RECORD_ID' \
  -X DELETE \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Success returns `204 No Content`.

# Schema administration

Schema mutation is an administrative/system capability. Destructive collection, field and managed many-to-many deletion requires an explicit `destructive=true` query flag where documented below.

## Collections

```text
GET    /schema/collections
POST   /schema/collections
GET    /schema/collections/:collection
PATCH  /schema/collections/:collection
DELETE /schema/collections/:collection?destructive=true
```

Create:

```bash
curl 'http://localhost:3008/schema/collections' \
  -X POST \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"Customer Requests",
    "collection":"customer_requests",
    "note":"Incoming sales and support requests",
    "hidden":false,
    "metadata":{"icon":"inbox","sort":20},
    "systemFields":["created_at","updated_at","created_by","updated_by"]
  }'
```

Changing only `name`, `note`, visibility or UI metadata does not rename the physical collection key.

## Fields

```text
GET    /schema/collections/:collection/fields
POST   /schema/collections/:collection/fields
GET    /schema/collections/:collection/fields/:field
PATCH  /schema/collections/:collection/fields/:field
PATCH  /schema/collections/:collection/fields/:field/schema
DELETE /schema/collections/:collection/fields/:field?destructive=true
```

Example string field:

```json
{
  "name": "Title",
  "field": "title",
  "type": "string",
  "length": 255,
  "required": true
}
```

Example decimal field:

```json
{
  "name": "Sales Price",
  "field": "sales_price",
  "type": "decimal",
  "precision": 12,
  "scale": 2
}
```

File/Image controls are UUID-backed semantic fields selected from the Files library:

```json
{
  "name": "Cover Image",
  "field": "cover_image",
  "type": "uuid",
  "interface": "image",
  "options": {
    "accept": "image/*",
    "preview": true
  }
}
```

Physical field mutations such as required/nullability and managed indexing use the separate `/schema` field mutation endpoint so UI metadata changes are not confused with DDL changes.

See [`data-model.md`](data-model.md) for field families, system fields, deletion behavior and relation modeling.

## Relations

```text
GET    /schema/relations
GET    /schema/relations/:manyCollection/:manyField
GET    /schema/collections/:collection/relations/o2m
POST   /schema/relations/m2o
DELETE /schema/relations/m2o/:manyCollection/:manyField
POST   /schema/relations/o2o
DELETE /schema/relations/o2o/:manyCollection/:manyField
POST   /schema/relations/m2m
DELETE /schema/relations/m2m/:junctionCollection?destructive=true
```

Many-to-one:

```json
{
  "manyCollection": "articles",
  "manyField": "author_id",
  "oneCollection": "authors",
  "onDelete": "SET NULL"
}
```

One-to-one uses the same many/one shape and is physically enforced with a foreign key plus unique index.

Managed many-to-many:

```json
{
  "junctionCollection": "article_tags",
  "leftCollection": "articles",
  "rightCollection": "tags"
}
```

## Extensible system resources

Administrators may add bounded optional custom fields to explicitly extensible system collections:

```text
POST /schema/system-collections/:collection/fields
```

Current supported resources include users, files and roles. Internal session/token/permission/audit structures are not made generically extensible through this endpoint.

# Users

```text
GET    /users
POST   /users
GET    /users/:id
PATCH  /users/:id
DELETE /users/:id
```

Management-created accounts are treated as verified management users. Delegated user-management permissions still enforce protected Administrator/Public role invariants.

# Roles and permissions

```text
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

A permission is scoped to a role, collection/resource and action (`read`, `create`, `update`, `delete`). Project collection permissions may also define field allowlists, row filters and prospective create/update validation rules.

Selected system resources such as users, files and roles can be explicitly delegated through their dedicated services while protected resource invariants remain enforced.

See [`permissions.md`](permissions.md).

# Files

```text
GET    /files
POST   /files
POST   /files/reconcile
GET    /files/:id
GET    /files/:id/content
PATCH  /files/:id
DELETE /files/:id
```

Files access follows the explicit `yuncms_files` permission model. This permits intentional authenticated or Public read access when an administrator grants it; filtered read grants can expose only a permitted subset.

## Upload

Upload bytes are sent directly instead of base64 JSON:

```bash
curl 'http://localhost:3008/files?storage=local' \
  -X POST \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/octet-stream' \
  -H 'X-Filename: product-photo.png' \
  -H 'X-Mimetype: image/png' \
  -H 'X-Title: Product photo' \
  --data-binary '@./product-photo.png'
```

When an S3-compatible driver is configured, use `?storage=s3`.

## Download

```bash
curl 'http://localhost:3008/files/FILE_ID/content' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --output downloaded-file.bin
```

Content reads enforce the same Files read permission and row filter as metadata reads.

## Reconciliation

`POST /files/reconcile` is an administrative maintenance operation. It is dry-run by default:

```json
{
  "storage": "local",
  "deleteOrphans": false,
  "minimumAgeMs": 3600000
}
```

See [`files.md`](files.md).

# Studio navigation and settings

```text
GET /studio-navigation
GET /studio-settings
GET /studio-settings/logo
GET /studio-settings/favicon
PATCH /studio-settings
```

Safe display settings are readable before authentication so the login/reset/verification screens can render configured branding. Updating Studio settings requires administrative/system access.

Logo and favicon settings point to Files records rather than arbitrary external asset URLs.

See [`studio.md`](studio.md) and [`studio-customization.md`](studio-customization.md).

# Audit

```text
GET  /audit
POST /audit/cleanup
```

Audit access and cleanup are privileged operations. Retention and cleanup batch limits are configurable. Schema/data/file/auth lifecycle events record request ids and relevant resource metadata without intentionally exposing plaintext credentials.

# AI assistant

When configured, the AI API is mounted under:

```text
/ai
```

The built-in Studio assistant uses the authenticated request's normal accountability. Model/tool access does not create an Administrator bypass. Data-changing tools also require the configured AI write capability and the user's selected per-conversation access mode.

See [`ai-assistant.md`](ai-assistant.md) for configuration, privacy, write modes and prompt-injection boundaries.

# MCP

When enabled, MCP is mounted under:

```text
/mcp
```

MCP requests reuse YunCMS services, Items query limits and RBAC. Administrators manage endpoint access, authentication, Host/Origin boundaries, writes and result limits in Studio.

See [`mcp.md`](mcp.md) for transport, tools, authentication, origin/host controls and write configuration.

# Endpoint extensions

An installed endpoint extension with id `orders` is mounted at:

```text
/extensions/orders
```

Extension routers run after authentication middleware and can reuse request accountability and registered services. See [`extensions.md`](extensions.md).

# Request protection

The HTTP layer includes:

- security headers and same-origin Studio policy;
- configurable API and authentication rate limits;
- optional Redis-backed shared rate-limit state;
- pressure limits for concurrent requests/heap pressure;
- structured request ids and redacted error logging;
- request-size limits for JSON and file uploads;
- fail-closed query/schema/permission validation.

Configuration details are in [`configuration.md`](configuration.md) and deployment guidance is in [`deployment.md`](deployment.md).

# Related documentation

- [`api-query-language.md`](api-query-language.md) — all Items query methods and limits.
- [`data-model.md`](data-model.md) — collections, fields, system fields and relations.
- [`auth.md`](auth.md) — authentication and external providers.
- [`permissions.md`](permissions.md) — RBAC, row filters, field permissions and system-resource delegation.
- [`files.md`](files.md) — local/S3 storage and reconciliation.
- [`extensions.md`](extensions.md) — endpoint and hook extensions.
