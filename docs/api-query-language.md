# Items API Query Language

This guide documents the query options available on YunCMS collection reads. All examples use stable collection and field API keys; Studio display names are not used in URLs, filters, sorting or relation paths.

## Endpoints

Collection reads support the full query language:

```text
GET /items/:collection
```

Single-record reads support field selection and relation expansion:

```text
GET /items/:collection/:id?fields=...&expand=...
```

Authenticated requests normally send:

```http
Authorization: Bearer <access-token-or-api-token>
```

Unauthenticated requests use the Public role. Public access is deny-by-default until an administrator explicitly grants the required permission.

## Query parameters

| Parameter | Purpose | Important limits |
| --- | --- | --- |
| `fields` | Select scalar fields and project relations | 100 field tokens; 20 relation nodes; depth 4 |
| `filter` | JSON filter tree | depth 8; 100 filter nodes; 100 values per `_in`/`_nin` |
| `search` | Search readable `string`/`text` fields | 200 characters |
| `sort` | Comma-separated sort fields | 20 fields |
| `aggregate` | `count`, `countDistinct`, `sum`, `avg`, `min`, `max` | 20 aggregate field entries |
| `groupBy` | Group aggregate rows | 10 fields; requires `aggregate` |
| `limit` | Maximum rows returned | default 100; range 1–500 |
| `offset` | Rows skipped before the page | range 0–1,000,000 |
| `expand` | Convenience expansion for direct/virtual relation aliases | shares the 20-node relation budget |

Unknown parameters are rejected with `INVALID_QUERY` rather than ignored.

## Fields

### Select specific scalar fields

```text
fields=id,title,status
```

### Select all readable scalar fields

```text
fields=*
```

`*` means every field visible to the current read permission. It never widens a role field allowlist.

### Select a relation field

For `articles.author_id -> authors.id`:

```text
fields=id,title,author_id.name
```

Example response:

```json
{
  "data": [
    {
      "id": "article-1",
      "title": "Example",
      "author_id": {
        "name": "Ada"
      }
    }
  ]
}
```

### Select all readable fields inside a relation

```text
fields=id,title,author_id.*
```

### Select root fields and every readable first-level relation

```text
fields=*.*
```

`*.*` expands all readable relation descriptors available at the root collection and selects all readable target fields for those first-level relations. It does not mean unlimited recursive traversal; normal relation depth, node, row and query-cost limits still apply.

### Nested relations

Relation paths can be nested up to four levels:

```text
fields=id,author_id.company_id.country_id.name
```

Cyclic relation paths are rejected.

## Relation types

YunCMS projects relations as normal JSON values while retaining the same request accountability on every target collection.

### Many-to-one and one-to-one

A direct to-one relation returns an object or `null`:

```text
fields=id,title,author_id.name
```

### Reverse one-to-many

If `comments.article_id -> articles.id`, YunCMS exposes a virtual reverse alias on `articles`. When the default alias does not collide with a physical field it is normally the many-side collection key:

```text
fields=id,title,comments.text
```

Result:

```json
{
  "id": "article-1",
  "title": "Example",
  "comments": [
    { "text": "First" },
    { "text": "Second" }
  ]
}
```

Relation metadata may define a safe `reverseField`/`alias`. If an automatically preferred alias collides with a real field, YunCMS derives a deterministic fallback alias.

### Reverse one-to-one

The reverse side of a one-to-one relation uses the same virtual-alias model but returns one object or `null` instead of an array.

### Many-to-many

Managed many-to-many relations expose a virtual target alias. For an articles/tags relation:

```text
fields=id,title,tags.id,tags.name
```

The managed junction is used for traversal but is not emitted in the response. The caller must have read access to the source collection, the junction collection and the target collection. Junction row filters and target row/field permissions are enforced.

### `expand`

`expand` is a convenience syntax when all readable fields of a relation are wanted:

```text
fields=id,title&expand=author_id
```

Multiple aliases are comma-separated:

```text
expand=author_id,comments
```

`expand` and relation paths in `fields` use the same relation planner, RBAC checks and relation budget.

## Filters

`filter` is a JSON object. When sent in a URL it should be URL-encoded by the HTTP client.

Example:

```json
{
  "status": { "_eq": "published" },
  "price": { "_gte": 100, "_lt": 500 }
}
```

With `curl`:

```bash
curl --get 'http://localhost:3008/items/products' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'filter={"status":{"_eq":"published"},"price":{"_gte":100,"_lt":500}}'
```

### Operators

| Operator | Meaning |
| --- | --- |
| `_eq` | equals |
| `_neq` | not equal |
| `_lt` | less than |
| `_lte` | less than or equal |
| `_gt` | greater than |
| `_gte` | greater than or equal |
| `_in` | value is in an array |
| `_nin` | value is not in an array |
| `_null` | SQL NULL check |
| `_nnull` | SQL NOT NULL check |
| `_contains` | text contains value |
| `_starts_with` | text starts with value |
| `_ends_with` | text ends with value |

Use `_null` / `_nnull` for null checks:

```json
{
  "published_at": { "_null": true }
}
```

`_eq: null` and `_neq: null` are intentionally rejected so NULL semantics are explicit.

`_in` and `_nin` require arrays:

```json
{
  "status": { "_in": ["paid", "processing"] }
}
```

An empty `_in` matches no rows; an empty `_nin` excludes no rows. Each array accepts at most 100 values.

Text operators escape SQL LIKE wildcard characters in user input before binding.

### AND behavior

Different field clauses in the same object are combined with `AND`:

```json
{
  "active": { "_eq": true },
  "priority": { "_gte": 5 }
}
```

Multiple operators on one field are also combined with `AND`:

```json
{
  "price": { "_gte": 100, "_lte": 500 }
}
```

### `_and` and `_or`

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

`_and` and `_or` require non-empty arrays. Filter nesting is limited to 8 levels and 100 total filter nodes.

### Permission filters

A caller filter never replaces the role's row filter. YunCMS combines the permission filter and caller filter with `AND`, so a user cannot broaden access with `_or` or another query expression.

### Relation filtering

Filters currently target scalar fields of the collection being queried. Relation-path filters such as `author_id.name` are not accepted.

## Search

`search` performs a case behavior determined by the configured MySQL collation and searches across readable `string` and `text` fields of the current collection:

```text
search=acme
```

Example:

```bash
curl --get 'http://localhost:3008/items/customers' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'search=acme'
```

Search is combined with the permission row filter and explicit `filter` using `AND`. If the caller has no readable string/text fields, the search returns no rows rather than inspecting hidden fields.

## Sorting

Ascending:

```text
sort=title
```

Descending:

```text
sort=-created_at
```

Multiple fields:

```text
sort=-created_at,title
```

Sort fields must exist and be readable. Relation-path sorting is not accepted.

## Pagination

```text
limit=25&offset=0
limit=25&offset=25
```

Normal collection responses include permission-aware metadata:

```json
{
  "data": [],
  "meta": {
    "total_count": 243,
    "limit": 25,
    "offset": 25
  }
}
```

`total_count` is calculated after the effective permission/user filter.

## Aggregates

`aggregate` is a JSON object.

Count permission-visible rows:

```text
aggregate={"count":"*"}
```

Count a field:

```text
aggregate={"count":"id"}
```

Distinct count:

```text
aggregate={"countDistinct":"customer_id"}
```

Multiple calculations:

```json
{
  "count": "*",
  "sum": "total",
  "avg": "total",
  "min": "total",
  "max": "total"
}
```

Every aggregate field must be readable. `*` is supported only by `count`.

Typical result keys are derived from the function and field:

```json
{
  "data": [
    {
      "count": 42,
      "sum_total": "12500.00",
      "avg_total": "297.619048"
    }
  ]
}
```

Exact numeric representation follows the MySQL driver/value type used for that field.

## Grouping

`groupBy` requires `aggregate`:

```text
aggregate={"count":"*","sum":"total"}&groupBy=status
```

Example output:

```json
{
  "data": [
    { "status": "paid", "count": 20, "sum_total": "8000.00" },
    { "status": "processing", "count": 8, "sum_total": "2500.00" }
  ]
}
```

Multiple grouping fields are comma-separated:

```text
groupBy=status,currency
```

Up to 10 group fields are accepted.

## Combining query options

```bash
curl --get 'http://localhost:3008/items/orders' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'fields=id,order_no,total,status,customer_id.name' \
  --data-urlencode 'filter={"status":{"_in":["paid","processing"]},"total":{"_gte":1000}}' \
  --data-urlencode 'search=acme' \
  --data-urlencode 'sort=-created_at,order_no' \
  --data-urlencode 'limit=50' \
  --data-urlencode 'offset=0'
```

## Query safety limits

YunCMS applies structural limits before SQL execution:

```text
default limit             100
maximum limit             500
maximum fields            100
maximum relation nodes     20
maximum relation depth      4
maximum to-many rows      2000 per expansion operation
maximum sort fields        20
maximum offset        1,000,000
maximum filter depth        8
maximum filter nodes      100
maximum _in/_nin values   100
maximum search length     200 characters
maximum aggregate entries  20
maximum group fields       10
maximum query cost       2000
```

The query-cost score increases with row limit, field count, sorting, relation count/depth, search and aggregates. A structurally valid but overly expensive request fails with `QUERY_COST_LIMIT` instead of running an unbounded query.

## Error behavior

Malformed or unsupported input returns a structured 4xx error. Examples include:

- unknown query parameter;
- unknown/unreadable field;
- malformed JSON filter/aggregate;
- unsupported filter operator;
- invalid `limit`/`offset`;
- relation depth/node limit;
- cyclic relation path;
- query-cost limit.

Typical shape:

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

## JavaScript example

```js
const params = new URLSearchParams({
  fields: 'id,title,author_id.name',
  filter: JSON.stringify({
    status: { _eq: 'published' },
    priority: { _gte: 5 },
  }),
  sort: '-created_at',
  limit: '25',
  offset: '0',
});

const response = await fetch(`/items/articles?${params}`, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

const result = await response.json();
```

## Supported boundary

The Items query language intentionally rejects features it does not implement. Current reads do not accept:

- relation-path filtering;
- relation-path sorting;
- per-relation nested filter/sort/limit query objects;
- arbitrary SQL expressions/functions;
- unknown query parameters.

This fail-closed behavior makes integration mistakes visible instead of silently changing query meaning.

## Related guides

- [`rest-api.md`](rest-api.md) — REST endpoint reference.
- [`permissions.md`](permissions.md) — row, field and action permissions.
- [`data-model.md`](data-model.md) — collections, fields and relations.
- [`mcp.md`](mcp.md) — MCP access uses the same service and permission model.
