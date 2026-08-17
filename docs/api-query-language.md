# YunCMS Items API — Query Language

YunCMS turns every project collection into a predictable REST resource. You define the schema in Studio or through the Schema API, then read and write records through `/items/<collection-key>`.

This guide documents the query language implemented on branch `16-08-2026`.

> **Display names are for people. API keys are for code.** A collection displayed as `Müşteri Talepleri` may have the stable API key `musteri_talepleri`. URLs, JSON payload field names, filters, sorting and relation expansion always use the machine key.

## Base URL and authentication

A default local installation listens on:

```text
http://localhost:3008
```

Authenticated requests use a Bearer access token or an API token:

```http
Authorization: Bearer <token>
```

Example:

```bash
curl 'http://localhost:3008/items/musteri_talepleri' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

The Public role can also read project collections when you explicitly grant public read permission. Public access is deny-by-default.

---

## Read a collection

```http
GET /items/:collection
```

Example:

```bash
curl 'http://localhost:3008/items/articles' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Response:

```json
{
  "data": [
    {
      "id": "b74cb835-d7fe-42a8-9f1a-95dc5c02b46d",
      "title": "Hello YunCMS",
      "status": "published"
    }
  ],
  "meta": {
    "total_count": 1,
    "limit": 100,
    "offset": 0
  }
}
```

`total_count` is calculated after permission filters and user filters are applied, so it represents the rows the current accountability is actually allowed to see.

## Supported collection query parameters

| Parameter | Purpose | Default / limit |
| --- | --- | --- |
| `fields` | Select returned field keys | all readable fields |
| `filter` | JSON filter object | none |
| `sort` | Comma-separated sort keys | database/default order |
| `limit` | Maximum number of records returned | `100`, max `500` |
| `offset` | Number of matching rows to skip | `0` |
| `expand` | Expand direct relation fields | max 8 fields |

Unknown query parameters fail with `INVALID_QUERY`; YunCMS does not silently ignore typos.

---

# Selecting fields

Use a comma-separated list:

```http
GET /items/articles?fields=id,title,status
```

Curl:

```bash
curl --get 'http://localhost:3008/items/articles' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'fields=id,title,status'
```

`fields=*` selects every field that is readable under the active permission:

```http
GET /items/articles?fields=*
```

Important rules:

- use **field API keys**, not display names;
- duplicate field names are de-duplicated;
- requesting an unknown or forbidden field fails closed;
- role field allowlists are applied before the query is compiled.

---

# Sorting

Ascending:

```http
GET /items/articles?sort=title
```

Descending uses a `-` prefix:

```http
GET /items/articles?sort=-published_at
```

Multiple keys are comma-separated and evaluated left-to-right:

```http
GET /items/articles?sort=-published_at,title
```

Equivalent SQL intent:

```text
ORDER BY published_at DESC, title ASC
```

Unknown or unreadable sort fields are rejected.

---

# Pagination

YunCMS uses `limit` + `offset` pagination.

First page with 25 rows:

```http
GET /items/articles?limit=25&offset=0
```

Second page:

```http
GET /items/articles?limit=25&offset=25
```

Third page:

```http
GET /items/articles?limit=25&offset=50
```

Allowed values:

- `limit`: integer `1`–`500`;
- `offset`: integer `0` or greater.

The response always includes:

```json
{
  "meta": {
    "total_count": 243,
    "limit": 25,
    "offset": 50
  }
}
```

A typical UI page number can be converted to an offset with:

```js
const offset = (page - 1) * pageSize;
```

---

# Filtering

`filter` is a JSON object. Because it is carried in the URL, URL-encode it in production clients. With curl, `--data-urlencode` is the easiest safe form.

## Equality

Filter object:

```json
{
  "status": { "_eq": "published" }
}
```

Curl:

```bash
curl --get 'http://localhost:3008/items/articles' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'filter={"status":{"_eq":"published"}}'
```

## Not equal

```json
{
  "status": { "_neq": "archived" }
}
```

## Numeric/date comparison

```json
{
  "price": { "_gte": 100, "_lt": 500 }
}
```

Supported comparison operators:

| Operator | Meaning |
| --- | --- |
| `_eq` | equal |
| `_neq` | not equal |
| `_lt` | less than |
| `_lte` | less than or equal |
| `_gt` | greater than |
| `_gte` | greater than or equal |

For `NULL`, do not use `_eq: null` or `_neq: null`; use `_null` / `_nnull`.

## IN / NOT IN

```json
{
  "status": { "_in": ["draft", "published"] }
}
```

```json
{
  "status": { "_nin": ["deleted", "archived"] }
}
```

`_in` and `_nin` require arrays.

An empty `_in` intentionally matches nothing. An empty `_nin` intentionally excludes nothing.

## NULL checks

Is NULL:

```json
{
  "published_at": { "_null": true }
}
```

Is NOT NULL:

```json
{
  "published_at": { "_nnull": true }
}
```

Both operators require a boolean.

## Text matching

Contains:

```json
{
  "title": { "_contains": "YunCMS" }
}
```

Starts with:

```json
{
  "slug": { "_starts_with": "news-" }
}
```

Ends with:

```json
{
  "email": { "_ends_with": "@example.com" }
}
```

YunCMS escapes SQL LIKE wildcard characters (`%`, `_`, `\\`) in user values before binding them, so the text is treated as search text rather than raw LIKE syntax.

## Multiple operators on one field

Operators inside the same field object are combined with `AND`:

```json
{
  "price": {
    "_gte": 100,
    "_lte": 1000
  }
}
```

## Multiple fields

Top-level field conditions are also combined with `AND`:

```json
{
  "status": { "_eq": "published" },
  "price": { "_lte": 500 }
}
```

## Explicit AND groups

```json
{
  "_and": [
    { "status": { "_eq": "published" } },
    { "price": { "_gte": 100 } }
  ]
}
```

`_and` requires a non-empty array of filter objects.

## OR groups

```json
{
  "_or": [
    { "status": { "_eq": "published" } },
    { "featured": { "_eq": true } }
  ]
}
```

## Nested logic

```json
{
  "_and": [
    { "active": { "_eq": true } },
    {
      "_or": [
        { "priority": { "_gte": 8 } },
        { "featured": { "_eq": true } }
      ]
    }
  ]
}
```

Curl:

```bash
curl --get 'http://localhost:3008/items/tasks' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'filter={"_and":[{"active":{"_eq":true}},{"_or":[{"priority":{"_gte":8}},{"featured":{"_eq":true}}]}]}'
```

---

# Combining fields, filter, sort and pagination

```bash
curl --get 'http://localhost:3008/items/orders' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'fields=id,order_no,total,status,created_at' \
  --data-urlencode 'filter={"status":{"_in":["paid","processing"]},"total":{"_gte":1000}}' \
  --data-urlencode 'sort=-created_at,order_no' \
  --data-urlencode 'limit=50' \
  --data-urlencode 'offset=0'
```

This is the normal production pattern for tables, dashboards and server-side list views.

---

# Direct relation expansion

Use `expand` to replace a direct foreign-key field with its readable target record.

Suppose `articles.author_id` points to `authors.id`.

```http
GET /items/articles?fields=id,title,author_id&expand=author_id
```

Response:

```json
{
  "data": [
    {
      "id": "...",
      "title": "YunCMS API Guide",
      "author_id": {
        "id": "...",
        "name": "Ada"
      }
    }
  ],
  "meta": {
    "total_count": 1,
    "limit": 100,
    "offset": 0
  }
}
```

Rules:

- at most 8 direct relation fields can be expanded in one request;
- `expand` accepts a comma-separated list;
- the source field must be readable;
- only direct to-one relations are expanded in V1;
- junction/M2M expansion is not implemented in V1;
- target records are read using the **same accountability**;
- target row filters and target field allowlists still apply;
- if the current user cannot see the target row, the expanded value becomes `null` rather than bypassing permissions;
- when `fields` is explicitly provided, YunCMS internally ensures the relation key needed for expansion is selected.

Example with two expansions:

```http
GET /items/orders?expand=customer_id,owner_id
```

---

# Read one record

```http
GET /items/:collection/:id
```

Example:

```bash
curl --get 'http://localhost:3008/items/articles/b74cb835-d7fe-42a8-9f1a-95dc5c02b46d' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'fields=id,title,status'
```

Direct expansion is also supported:

```bash
curl --get 'http://localhost:3008/items/articles/RECORD_ID' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'expand=author_id'
```

If the row does not exist **or is hidden by RBAC**, the API returns a not-found response. This avoids leaking whether a forbidden row exists.

---

# Create a record

```http
POST /items/:collection
Content-Type: application/json
```

```bash
curl 'http://localhost:3008/items/musteri_talepleri' \
  -X POST \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "baslik": "Yeni teklif talebi",
    "durum": "open",
    "oncelik": 8
  }'
```

Payload keys are field **API keys**.

YunCMS rejects:

- unknown fields;
- readonly fields;
- fields outside the role field allowlist;
- missing required fields without a database/default preset;
- write-validation rules that do not pass.

System-managed accountability fields such as `created_at`, `created_by`, `updated_at`, `updated_by` are written by YunCMS rather than trusted from the client.

---

# Update a record

```http
PATCH /items/:collection/:id
Content-Type: application/json
```

```bash
curl 'http://localhost:3008/items/musteri_talepleri/RECORD_ID' \
  -X PATCH \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"durum":"resolved"}'
```

The same field permissions, row filters and write-validation rules apply to updates.

---

# Delete a record

```http
DELETE /items/:collection/:id
```

```bash
curl 'http://localhost:3008/items/musteri_talepleri/RECORD_ID' \
  -X DELETE \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Successful deletion returns HTTP `204 No Content`.

---

# JavaScript fetch examples

## Build a filtered list URL

```js
const params = new URLSearchParams({
  fields: 'id,title,status,published_at',
  filter: JSON.stringify({
    status: { _eq: 'published' },
    published_at: { _nnull: true },
  }),
  sort: '-published_at',
  limit: '25',
  offset: '0',
});

const response = await fetch(`http://localhost:3008/items/articles?${params}`, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

const { data, meta } = await response.json();
```

## Create

```js
const response = await fetch('http://localhost:3008/items/articles', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title: 'Hello YunCMS',
    status: 'draft',
  }),
});

const { data } = await response.json();
```

---

# RBAC is part of every query

The query language never replaces permission enforcement. The effective request is conceptually:

```text
role row filter
AND user-supplied filter
AND readable field allowlist
AND requested sorting/selection
```

This means a user cannot widen access by sending their own `_or`, requesting `fields=*`, sorting by a hidden field or expanding a target collection they cannot read.

Permission and user values are bound as SQL parameters. Dynamic field/collection identifiers are validated against the schema and quoted separately.

---

# Common `INVALID_QUERY` mistakes

### Using display names instead of API keys

Wrong:

```text
fields=Ürün Fiyatı
```

Correct:

```text
fields=urun_fiyati
```

### Passing filter JSON without URL encoding

Prefer:

```bash
--data-urlencode 'filter={"status":{"_eq":"published"}}'
```

### Using `null` with `_eq`

Wrong:

```json
{ "published_at": { "_eq": null } }
```

Correct:

```json
{ "published_at": { "_null": true } }
```

### More than 500 rows in one request

Use multiple pages. `limit` is intentionally capped at 500.

### Expanding a junction relation

V1 expansion is for direct to-one relations only.

---

# Related docs

- [`rest-api.md`](rest-api.md) — complete endpoint map and examples.
- [`permissions.md`](permissions.md) — RBAC, field allowlists, row filters and write validation.
- [`database.md`](database.md) — schema engine and MySQL behavior.
- [`files.md`](files.md) — file upload/download/storage behavior.
- [`auth.md`](auth.md) — login, sessions, refresh and API tokens.
