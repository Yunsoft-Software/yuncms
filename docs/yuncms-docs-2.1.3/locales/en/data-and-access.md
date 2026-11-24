# Data Model, Permissions and REST API (YunCMS 2.1.3)

> **Published Version:** `YunCMS 2.1.3` · **Git Tag:** `v2.1.3` · **Commit:** `818019ea00312f3a0b465b5f99759d2e13021371`

YunCMS `2.1.3` stores every project collection as a real MySQL table while keeping schema metadata, REST endpoints, Studio forms, and RBAC rules synchronized.

## Data Model

Open **Data Model** from the application rail to create collections, fields, folders, and relations:

![YunCMS 2.1.3 Data Model screen](screenshot:studio-data-model-en)

- **Collections and keys**: each collection has a human-readable display name and a stable API/table key (for example `products`). Keep API keys stable once external integrations depend on them.
- **Navigation organization**: create folders, drag handles to reorder collections, toggle single-item (singleton) presentation, and hide internal collections from Content navigation without changing API permissions.
- **Field types**: `integer`, `bigint`, `decimal`, `string`, `text`, `boolean`, `date`, `datetime`, `timestamp`, `json`, and `uuid` (including `file` and `image` interfaces backed by Files).
- **System fields**: optionally enable `created_at`, `updated_at`, `created_by`, and `updated_by` when creating collections.
- **Relations**: supports many-to-one (`M2O`), one-to-one (`O2O`), reverse one-to-many (`O2M`), and managed many-to-many (`M2M`) junctions.

### JSON numbers and exact integers in YunCMS 2.1.3

In YunCMS `2.1.3`, native reads preserve JavaScript numeric types for numbers nested inside MySQL `JSON` columns (for example `{"count": 42, "ratio": 1.5}` returns numeric `42` and `1.5`). For integers outside JavaScript's safe integer range, store an explicit decimal string in JSON or use a dedicated SQL `bigint` column, which continues returning exact decimal strings.

## Roles and Permissions

Access in YunCMS `2.1.3` is **deny-by-default**. Administrators configure roles under **Access → Roles & Permissions**:

![YunCMS 2.1.3 collection permission matrix](screenshot:studio-permissions-en)

For each collection and action (`read`, `create`, `update`, `delete`), a role can grant simple access or open **Configure** to define:

- **Field allowlists**: restrict which fields a role may read or write.
- **Row filters**: server-enforced filter predicates combined with caller queries using `AND`.
- **Write validation rules**: prospective checks on create and update payloads.
- **Public role**: intentionally expose only explicitly permitted collections or filtered Files to unauthenticated callers; system resources remain blocked from Public access.

In YunCMS `2.1.3`, permission mutations invalidate the shared permission cache after transaction commit so concurrent requests running under an older generation cannot repopulate stale grants.

## REST API quickstart

Authenticate to obtain a session access token (or create a scoped static API token for server integrations):

```bash
curl 'http://localhost:3008/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.example","password":"your-password"}'
```

### Items CRUD endpoints

```text
GET    /items/:collection
GET    /items/:collection/:id
POST   /items/:collection
PATCH  /items/:collection/:id
DELETE /items/:collection/:id
```

### Querying fields, relations, filters and aggregates

Read selected fields with a first-level relation, filter, sort, and pagination:

```bash
curl --get 'http://localhost:3008/items/products' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  --data-urlencode 'fields=id,name,sku,price,stock,category_id.name' \
  --data-urlencode 'filter={"status":{"_eq":"active"},"stock":{"_gte":10}}' \
  --data-urlencode 'sort=name' \
  --data-urlencode 'limit=25'
```

Supported filter operators include `_eq`, `_neq`, `_lt`, `_lte`, `_gt`, `_gte`, `_in`, `_nin`, `_null`, `_nnull`, `_contains`, `_starts_with`, `_ends_with`, plus nested `_and` and `_or`.

Aggregate and group records:

```bash
curl --get 'http://localhost:3008/items/products' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  --data-urlencode 'aggregate={"count":"*","sum":"stock"}' \
  --data-urlencode 'groupBy=status'
```

Upload a file through the Files API:

```bash
curl 'http://localhost:3008/files?storage=local' \
  -X POST \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -H 'Content-Type: application/octet-stream' \
  -H 'X-Filename: sample-product.png' \
  -H 'X-Mimetype: image/png' \
  --data-binary '@./sample-product.png'
```

Continue to [Features, Licensing and Production Operations (YunCMS 2.1.3)](doc:licensing-and-operations).
