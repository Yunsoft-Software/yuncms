# YunCMS Items API — Query Language

This guide documents the query language currently implemented on branch `22-08-2026`.

Display names are for people; URLs, JSON payloads, filters, sorting and relation paths always use stable collection/field API keys.

## Base read endpoints

```text
GET /items/:collection
GET /items/:collection/:id
```

Authenticated requests use a YunCMS session access token or API token:

```http
Authorization: Bearer <token>
```

The Public role is deny-by-default. Every read described below still passes through normal collection, row and field permissions.

## Collection query parameters

| Parameter | Purpose | Limits |
| --- | --- | --- |
| `fields` | Scalar field selection plus nested relation projection | max 100 field tokens, max 20 relation nodes, max relation depth 4 |
| `filter` | JSON scalar filter tree | max depth/nodes enforced by query limits |
| `search` | Search readable string/text fields | bounded text length |
| `sort` | Comma-separated scalar sort fields | max 20 fields |
| `aggregate` | `count`, `countDistinct`, `sum`, `avg`, `min`, `max` | bounded aggregate field count |
| `groupBy` | Group aggregate output by readable scalar fields | requires `aggregate` |
| `limit` | Returned row count | default 100, max 500 |
| `offset` | Matching rows to skip | bounded maximum |
| `expand` | Legacy relation expansion alias | max 20 relation fields |

Unknown parameters fail with `INVALID_QUERY`. The complete normalized query also receives a bounded query-cost score; expensive combinations fail before SQL execution.

## Field selection

Scalar fields:

```text
fields=id,title,status
```

All readable scalar fields at the current level:

```text
fields=*
```

Nested direct relation:

```text
fields=id,title,author_id.name
fields=*,author_id.*
```

Nested paths may traverse up to four relation levels when the path is non-cyclic and remains inside the query-cost/node budgets:

```text
fields=id,author_id.company_id.country_id.name
```

`fields=*.*` selects every readable field at the root and expands all readable relation descriptors available at that level. This includes direct to-one fields and bounded reverse/to-many relation aliases described below.

A wildcard never widens an RBAC field allowlist. Target collections are resolved again with the same request accountability, including target row filters and field allowlists.

## Relation projection

### Direct M2O/O2O

If `articles.author_id -> authors.id`:

```text
fields=id,title,author_id.name
```

returns:

```json
{
  "id": "article-1",
  "title": "Example",
  "author_id": {
    "name": "Ada"
  }
}
```

Lookup keys may be fetched internally for matching and then removed from narrowed nested output.

### Reverse O2M

For a normal M2O relation such as:

```text
comments.article_id -> articles.id
```

YunCMS exposes a virtual reverse relation alias on `articles`. The default alias is the many-side collection key when it does not collide with a physical field:

```text
fields=id,title,comments.text
```

Example result:

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

If the default alias collides, YunCMS derives a deterministic fallback. Relation metadata may also provide a safe `reverseField`/`alias` value.

### Reverse O2O

The reverse side of an O2O relation uses the same virtual-alias model but returns one object or `null`, not an array.

### M2M

For a managed junction between `articles` and `tags`, the source collection receives a virtual target alias, normally the target collection key:

```text
fields=id,tags.name
```

The junction is only an internal traversal detail and is not emitted in the response. The request must have read access to the junction collection and to the target collection. Junction row filters and target row/field permissions are enforced.

To-many expansion is bounded; one expansion operation refuses to load more than the configured core cap (`2000` rows) and relation nodes contribute extra query cost.

### Legacy `expand`

Legacy direct syntax remains accepted:

```text
fields=id,title&expand=author_id
```

`expand` uses the same relation descriptor/RBAC machinery and the same relation-node budget.

## Filters

`filter` is a JSON object. Values are always SQL parameters; dynamic identifiers are validated against schema metadata.

Equality/comparison:

```json
{
  "status": { "_eq": "published" },
  "price": { "_gte": 100, "_lt": 500 }
}
```

Supported operators:

```text
_eq _neq _lt _lte _gt _gte
_in _nin
_null _nnull
_contains _starts_with _ends_with
```

Logical groups:

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

`_in`/`_nin`, filter nesting and total filter-node counts are bounded. LIKE wildcard characters in user text are escaped before binding.

Current boundary: filters target scalar fields on the current collection. Permission-aware relational filter traversal is still an active source task and is not documented as implemented.

## Search

`search` performs a bounded text search over readable string/text fields in the current collection:

```text
search=YunCMS
```

Search is combined with both the role row filter and an explicit user `filter` using `AND`.

## Sorting

Ascending:

```text
sort=title
```

Descending:

```text
sort=-created_at
```

Multiple scalar fields:

```text
sort=-created_at,title
```

Unknown or unreadable fields are rejected. Current boundary: relational sort paths are not implemented yet.

## Aggregate and groupBy

Count all permission-visible rows:

```text
aggregate={"count":"*"}
```

Multiple aggregates:

```json
{
  "count": "*",
  "sum": "total",
  "avg": "total"
}
```

Grouped aggregate:

```text
aggregate={"count":"*","sum":"total"}&groupBy=status
```

Supported aggregate functions are `count`, `countDistinct`, `sum`, `avg`, `min` and `max`. Aggregate/group fields must be readable scalar fields and still use the effective permission/user filter.

## Pagination

```text
limit=25&offset=0
limit=25&offset=25
```

Normal list responses include:

```json
{
  "meta": {
    "total_count": 243,
    "limit": 25,
    "offset": 25
  }
}
```

`total_count` is calculated after the effective row filter.

## Combining features

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

## RBAC and extension query hooks

The effective read flow is conceptually:

```text
parse + normalize
-> items.query extension filter
-> re-parse / revalidate / query-cost check
-> resolve RBAC
-> compile permission + user filters
-> execute bounded SQL/relation traversal
-> items.read action metadata
```

An `items.query` hook therefore cannot return raw SQL or use a transformed query to restore a forbidden field. The transformed AST is validated again and normal permission enforcement remains authoritative.

## Current deliberate boundary

Not currently implemented:

- relation-path filtering such as filtering `articles` by `author.name`;
- relation-path sorting;
- Directus-style `deep` per-relation filter/sort/limit options;
- arbitrary query functions/SQL expressions.

Those remain explicit source work rather than silently accepted parameters.

## Related docs

- [`rest-api.md`](rest-api.md) — endpoint reference.
- [`permissions.md`](permissions.md) — RBAC and row/field rules.
- [`mcp.md`](mcp.md) — MCP tools reuse this query/service layer.
