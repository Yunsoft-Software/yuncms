# YunCMS REST API Reference

YunCMS exposes a compact REST API around dynamic MySQL collections, schema administration, users/RBAC, Files and Studio settings. There is no GraphQL layer and no ORM-specific query language hidden behind the API.

This reference describes the implemented API on branch `16-08-2026`.

## Start here

Default local origin:

```text
http://localhost:3008
```

Most application endpoints expect:

```http
Authorization: Bearer <access-token-or-api-token>
```

JSON writes expect:

```http
Content-Type: application/json
```

For the full Items filtering/sorting/pagination grammar, see **[`api-query-language.md`](api-query-language.md)**.

---

# Human names vs API keys

YunCMS separates names intended for people from identifiers intended for code.

You can create a collection with a natural name:

```json
{
  "name": "Müşteri Talepleri",
  "collection": "musteri_talepleri"
}
```

Studio automatically suggests the machine key. The backend normalizes again and never trusts a browser-only transformation.

Examples:

| Display name | Suggested API/MySQL key |
| --- | --- |
| `Müşteri Talepleri` | `musteri_talepleri` |
| `Ürün Fiyatı` | `urun_fiyati` |
| `İçecek Ölçüsü` | `icecek_olcusu` |
| `2026 Ürünleri` | `collection_2026_urunleri` |

Field names work the same way:

```json
{
  "name": "Ürün Fiyatı",
  "field": "urun_fiyati",
  "type": "decimal"
}
```

The **display name may be changed later without renaming the physical table/column**. API URLs, JSON field names, filters, sort keys and relation keys use the stable machine identifier.

---

# Response format

## List response

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

## Single-resource response

```json
{
  "data": {
    "id": "..."
  }
}
```

## Error response

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

Known auth/input/schema conflicts map to stable 4xx responses. Retryable infrastructure failures map to 503. Unexpected server errors return a generic client message while structured server logs keep the internal error and request id after secret redaction.

---

# Authentication

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

## Login

```bash
curl 'http://localhost:3008/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "password": "your-password"
  }'
```

The authenticated identity includes the internal role id plus human-readable `role_name`.

Login, refresh and auth-action endpoints use configurable process-local rate limiting. See [`auth.md`](auth.md) for session/token lifecycle details.

---

# Items — dynamic collection data

```text
GET    /items/:collection
GET    /items/:collection/:id
POST   /items/:collection
PATCH  /items/:collection/:id
DELETE /items/:collection/:id
```

`:collection` is the machine key, for example `musteri_talepleri`.

## Read collection

```bash
curl --get 'http://localhost:3008/items/musteri_talepleri' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'fields=id,baslik,durum,oncelik' \
  --data-urlencode 'filter={"durum":{"_eq":"open"},"oncelik":{"_gte":5}}' \
  --data-urlencode 'sort=-oncelik,baslik' \
  --data-urlencode 'limit=25' \
  --data-urlencode 'offset=0'
```

Supported collection query parameters:

- `fields`
- `filter`
- `sort`
- `limit`
- `offset`
- `expand`

Full syntax and every filter operator: [`api-query-language.md`](api-query-language.md).

## Read one

```bash
curl --get 'http://localhost:3008/items/musteri_talepleri/RECORD_ID' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'fields=id,baslik,durum'
```

## Create

```bash
curl 'http://localhost:3008/items/musteri_talepleri' \
  -X POST \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "baslik": "Yeni teklif talebi",
    "durum": "open",
    "oncelik": 7
  }'
```

## Update

```bash
curl 'http://localhost:3008/items/musteri_talepleri/RECORD_ID' \
  -X PATCH \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"durum":"resolved"}'
```

## Delete

```bash
curl 'http://localhost:3008/items/musteri_talepleri/RECORD_ID' \
  -X DELETE \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Success returns `204 No Content`.

## Relation expansion

```bash
curl --get 'http://localhost:3008/items/articles' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'fields=id,title,author_id' \
  --data-urlencode 'expand=author_id'
```

V1 expands direct to-one relation fields only, max 8 per request. Target rows are loaded under the same accountability, so target row/field permissions remain enforced.

---

# Schema administration

Schema endpoints require administrator/system schema-management accountability.

## Collections

```text
GET    /schema/collections
POST   /schema/collections
GET    /schema/collections/:collection
PATCH  /schema/collections/:collection
DELETE /schema/collections/:collection?destructive=true
```

### Create a collection with a natural display name

```bash
curl 'http://localhost:3008/schema/collections' \
  -X POST \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Müşteri Talepleri",
    "collection": "musteri_talepleri",
    "note": "Müşteriden gelen talepler",
    "hidden": false,
    "metadata": {
      "icon": "inbox",
      "sort": 20
    },
    "systemFields": [
      "created_at",
      "updated_at",
      "created_by",
      "updated_by"
    ]
  }'
```

You may also omit a dedicated machine key and send the human text through `collection`; the backend normalizes it. Explicitly sending both is recommended for automation/config-as-code because the stable identifier is visible in the request.

### Change only the display name

```bash
curl 'http://localhost:3008/schema/collections/musteri_talepleri' \
  -X PATCH \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Müşteri Destek Talepleri"}'
```

This does **not** rename the physical MySQL table or change API URLs.

### Visibility/icon/sidebar order

These are collection metadata concerns managed by Data Model in Studio:

```json
{
  "hidden": false,
  "metadata": {
    "icon": "inbox",
    "sort": 30
  }
}
```

## Fields

```text
GET    /schema/collections/:collection/fields
POST   /schema/collections/:collection/fields
GET    /schema/collections/:collection/fields/:field
PATCH  /schema/collections/:collection/fields/:field
PATCH  /schema/collections/:collection/fields/:field/schema
DELETE /schema/collections/:collection/fields/:field?destructive=true
```

### Short text

```json
{
  "name": "Başlık",
  "field": "baslik",
  "type": "string",
  "length": 255,
  "required": true
}
```

### Decimal

```json
{
  "name": "Ürün Fiyatı",
  "field": "urun_fiyati",
  "type": "decimal",
  "precision": 12,
  "scale": 2,
  "required": false
}
```

### Image / File

Studio exposes File and Image as semantic field types. Physically they are UUID-backed references with a dedicated interface:

```json
{
  "name": "Kapak Görseli",
  "field": "kapak_gorseli",
  "type": "uuid",
  "interface": "image",
  "options": {
    "accept": "image/*",
    "preview": true
  }
}
```

### Change a field display name

```bash
curl 'http://localhost:3008/schema/collections/products/fields/urun_fiyati' \
  -X PATCH \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Satış Fiyatı"}'
```

The API field key remains `urun_fiyati`.

### Physical field changes

Physical mutation is intentionally separate:

```bash
curl 'http://localhost:3008/schema/collections/products/fields/urun_fiyati/schema' \
  -X PATCH \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"required":true,"indexed":true}'
```

Supported V1 physical changes include required/nullability, supported defaults, timestamp automation and managed single-field indexing. Arbitrary type conversion is intentionally not exposed as a casual metadata edit.

## Bounded system collection field extension

Schema managers may add custom optional fields to the explicitly extensible system resources:

```text
POST /schema/system-collections/:collection/fields
```

Current bounded resources:

- `yuncms_users`
- `yuncms_files`
- `yuncms_roles`

Internal sessions/tokens/permissions/audit resources remain fail-closed.

Example:

```bash
curl 'http://localhost:3008/schema/system-collections/yuncms_users/fields' \
  -X POST \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Departman",
    "field": "departman",
    "type": "string",
    "length": 100
  }'
```

Custom system fields are optional-only in V1 to avoid breaking existing system rows with an unsafe NOT NULL migration.

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

### M2O

```json
{
  "manyCollection": "articles",
  "manyField": "author_id",
  "oneCollection": "authors",
  "onDelete": "SET NULL"
}
```

### O2O

```json
{
  "manyCollection": "profiles",
  "manyField": "user_id",
  "oneCollection": "users",
  "onDelete": "CASCADE"
}
```

O2O is physically enforced with a foreign key + unique index.

### M2M

```json
{
  "junctionCollection": "article_tags",
  "leftCollection": "articles",
  "rightCollection": "tags"
}
```

Destructive collection, field and M2M deletion requires an explicit destructive flag; the HTTP verb alone is not treated as confirmation.

---

# Users

```text
GET    /users
POST   /users
GET    /users/:id
PATCH  /users/:id
DELETE /users/:id
```

Accounts created through the privileged management path are immediately email-verified and can sign in without waiting for a verification message.

Users access can be delegated through the bounded `yuncms_users` permission resource. Privilege-escalation guards still prevent delegated managers from assigning protected Administrator/Public roles or taking over Administrator accounts.

---

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

Project collection permissions support:

- action: `read`, `create`, `update`, `delete`;
- field allowlists;
- row filters;
- prospective create/update validation.

System resources are deliberately narrower. Users/Files may be delegated action-by-action, Roles read-only, Public never receives system-resource access.

See [`permissions.md`](permissions.md).

---

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

## Upload raw bytes

YunCMS uses raw binary request bodies for file uploads rather than base64 JSON.

```bash
curl 'http://localhost:3008/files' \
  -X POST \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/octet-stream' \
  -H 'X-Filename: product-photo.png' \
  -H 'X-Mimetype: image/png' \
  --data-binary '@./product-photo.png'
```

Studio additionally sends/uses file metadata and previews through the authenticated file content endpoint.

## Download/read bytes

```bash
curl 'http://localhost:3008/files/FILE_ID/content' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --output downloaded-file.bin
```

## Reconciliation

`POST /files/reconcile` is administrator-only. Default behavior is dry-run. Orphan deletion is explicit and age-guarded.

```json
{
  "storage": "local",
  "deleteOrphans": false,
  "minimumAgeMs": 3600000
}
```

See [`files.md`](files.md) for storage details.

---

# Studio settings and branding

```text
GET   /studio-settings
GET   /studio-settings/logo
GET   /studio-settings/favicon
PATCH /studio-settings
```

`GET /studio-settings` is intentionally public because login/reset/verification surfaces need safe display settings before authentication.

`PATCH /studio-settings` is administrator/system-only.

Logo and favicon configuration stores selected **Files ids**, not arbitrary external asset URLs. The narrow public logo/favicon endpoints expose only the currently configured branding images; they do not make the Files API public.

When no custom favicon is configured, Studio uses the default Yunsoft icon asset.

---

# Audit

```text
GET  /audit
POST /audit/cleanup
```

Audit access requires administrator/system accountability. Cleanup is explicit and bounded.

Example:

```json
{
  "retentionDays": 90,
  "batchSize": 1000,
  "maxBatches": 100
}
```

---

# Health / readiness

```text
GET /health
GET /ready
```

`/health` reports process health. `/ready` also checks MySQL connectivity.

Both run before application authentication so deployment infrastructure can probe them.

---

# HTTP hardening

The API:

- disables `X-Powered-By`;
- emits request ids;
- applies a narrow configured Studio CORS origin;
- emits `nosniff`, frame-deny, no-referrer and restrictive permissions-policy headers;
- sets same-origin resource policy;
- leaves HSTS to the real TLS/reverse-proxy deployment where proxy knowledge is available.

---

# Current deliberate limits

YunCMS is intentionally explicit about V1 boundaries:

- no GraphQL;
- no generic bulk REST mutation endpoints yet, even though bounded bulk service methods exist internally;
- no nested O2M/M2M expansion;
- direct relation expansion only;
- no arbitrary type-conversion UI;
- no untrusted extension sandbox;
- no automatic audit cleanup scheduler;
- very large Files/relation pickers are still candidates for server-side search/pagination expansion.

The goal is a small surface that behaves predictably rather than a giant API that silently does the wrong thing.
