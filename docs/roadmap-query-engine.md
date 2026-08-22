# Query Engine Roadmap — Directus-Parity Relational Queries

Status: design/roadmap only. This document does not claim that the features below are implemented.

Target branch baseline: `22-08-2026`.

## Purpose

YunCMS already has a useful, permission-aware REST query layer. The next query milestone is not to copy every Directus query feature blindly; it is to close the gaps that materially affect normal application development while preserving YunCMS principles:

- MySQL 8 only;
- `mysql2/promise`, no ORM;
- REST first;
- explicit accountability and service-layer authorization;
- bounded query cost;
- fail closed on unknown/unsupported query syntax;
- stable machine keys;
- predictable SQL and debuggable execution.

The target is a query engine that feels familiar to Directus users for the high-value relational/query cases without turning YunCMS into a second database language with unbounded behavior.

Reference behavior to study during implementation:

- Directus query parameters: https://directus.com/docs/guides/connect/query-parameters
- Directus filter rules: https://directus.com/docs/guides/connect/filter-rules

## Current baseline

On `22-08-2026`, YunCMS supports:

- `fields`;
- `filter`;
- `sort`;
- `limit`;
- `offset`;
- `fields=*`;
- one-level `fields=*.*`;
- one-level `relation.*`;
- one-level `relation.field`;
- legacy direct `expand`;
- nested `_and` / `_or`;
- comparison, IN/NOT IN, NULL and basic text operators;
- field-aware query validation;
- field allowlists;
- row-level permission filters;
- permission-aware direct to-one expansion;
- explicit depth/node/list/offset limits.

The current implementation is intentionally bounded and safe, but it is still a one-level direct-relation query engine. It does not yet provide the relational expressiveness expected from a mature data API.

## Main gaps to close

### 1. M2M and reverse-relation traversal

Required target behavior:

- M2O / O2O traversal;
- reverse O2M traversal where schema metadata exposes the relation;
- M2M traversal through the managed junction collection;
- nested field selection on all supported relation shapes;
- permission checks at every collection boundary;
- junction rows must not accidentally leak fields unless explicitly selected and permitted.

Example target shapes:

```text
fields=id,title,author.name
fields=id,title,tags.id,tags.name
fields=*,author.*,tags.*
```

For M2M, the API-facing representation should normally be the related target records rather than raw junction rows. A later explicit junction-selection syntax may be added only if a real use case requires it.

### 2. Bounded arbitrary-depth field traversal

Target syntax should remain Directus-familiar:

```text
fields=id,title,author.company.name
fields=*,author.*,author.company.*
fields=*.*.*
```

"Arbitrary depth" must mean syntactically general but operationally bounded.

Recommended defaults:

- `QUERY_MAX_RELATION_DEPTH=4`;
- hard maximum enforced even for administrators;
- cycle detection based on relation path, not only collection name;
- maximum selected relation nodes per request;
- maximum total projected fields after wildcard expansion.

A cyclic model such as `employee.manager.manager...` must never produce unbounded recursion.

### 3. Relational filtering

High-value target examples:

```json
{
  "author": {
    "company": {
      "country": { "_eq": "TR" }
    }
  }
}
```

```json
{
  "tags": {
    "name": { "_eq": "featured" }
  }
}
```

For to-many relations, the V1 relational semantics should be explicit:

- default nested to-many filter means "at least one related record matches";
- later `_some` / `_none` operators may make the semantics explicit and Directus-familiar;
- permission filters on the target collection are always combined with the caller relation filter.

Relational filters should compile to bounded `EXISTS` / `NOT EXISTS` subqueries rather than large result-multiplying joins where possible.

### 4. Relational sorting

Target examples:

```text
sort=author.name
sort=-author.company.name,title
```

Initial scope should support to-one relation sorting only.

Sorting by to-many relations is ambiguous and expensive unless an aggregation rule is specified. Do not invent an implicit rule. Keep to-many relational sort unsupported until an explicit syntax such as min/max/count is designed.

### 5. `deep`

A Directus-style `deep` parameter is valuable when a nested relation needs its own:

- filter;
- sort;
- limit;
- offset/first-page behavior;
- selected fields.

Target conceptual example:

```json
{
  "comments": {
    "_filter": { "status": { "_eq": "published" } },
    "_sort": ["-created_at"],
    "_limit": 5
  }
}
```

YunCMS should not accept every possible nested query option automatically. Start with a strict allowlist and apply independent cost limits per nested node plus a whole-query global budget.

### 6. Search

Add a top-level `search` parameter for common Content/Studio/API use cases.

Rules:

- search only readable/searchable fields;
- start with string/text fields;
- use bound parameters;
- escape LIKE wildcards;
- do not silently cast arbitrary JSON/blob/numeric fields;
- combine search with permission filter and caller filter using `AND`;
- document collation/case-sensitivity behavior rather than pretending it is database-independent.

Full-text indexing may be evaluated later. V1 search should prioritize correctness and predictable MySQL behavior.

### 7. Aggregate and groupBy

High-value first aggregates:

- `count`;
- `countDistinct`;
- `sum`;
- `avg`;
- `min`;
- `max`.

Target examples should be Directus-familiar but do not need byte-for-byte response compatibility if that harms clarity.

Required rules:

- aggregate only readable fields;
- apply the same collection read permission and row filter before aggregation;
- caller filter is ANDed with the permission filter;
- group-by fields must be readable;
- response must not reveal counts for rows hidden by RBAC;
- cap number of aggregate expressions and group keys;
- cap returned group cardinality;
- no arbitrary SQL expressions.

### 8. Query functions

Do not start with a generic SQL-function escape hatch.

Only add functions with explicit parser/planner support. Candidate functions:

- year/month/day extraction for date grouping/filtering;
- count of related records;
- safe lower/upper only if a concrete use case needs them.

Each function must have:

- supported input field types;
- explicit SQL compilation;
- RBAC validation;
- cost classification;
- tests.

## Architectural direction

The current direct parser-to-SQL helpers are appropriate for the existing small grammar. Deep relations, aggregates and nested query options will become fragile if implemented as repeated special cases.

The target architecture should be:

```text
HTTP query parameters
        |
        v
Query parser / normalization
        |
        v
Normalized query AST
        |
        v
Schema + accountability authorization
        |
        v
Cost / limit validation
        |
        v
MySQL query planner
        |
        v
Bound SQL + relation batch plans
        |
        v
Execution
        |
        v
Permission-safe response projection
```

### Normalized AST

The AST should describe intent without containing raw SQL.

Conceptual shape:

```js
{
  collection: 'articles',
  fields: [...],
  filter: {...},
  sort: [...],
  pagination: {...},
  relations: {
    author: {
      fields: [...],
      relations: {...}
    }
  },
  aggregate: null,
  groupBy: [],
  search: null
}
```

The exact structure can differ, but parser validation and SQL generation should no longer be inseparable once the grammar expands.

## Execution strategy

### Avoid N+1

Never resolve nested relations by running one query per source row.

Use one of two strategies depending on relation shape:

1. batched relation fetches keyed by IDs;
2. bounded SQL joins/EXISTS subqueries where they do not duplicate/balloon rows.

For deep projections, a level-by-level batch loader is preferable to a giant join tree because it keeps:

- permissions understandable;
- row cardinality predictable;
- response projection manageable;
- M2M junction handling explicit.

### Permission enforcement

Authorization is not a post-filter.

For every collection node in a query:

1. resolve `read` permission using the same accountability;
2. validate requested fields against the target field allowlist;
3. compile the target permission row filter;
4. combine target permission filter with relation/user filter;
5. hide inaccessible related records instead of fetching everything then stripping them in JavaScript.

A wildcard must never widen permissions.

A relation field being readable does not imply unrestricted read access to the target collection.

### Count/meta behavior

`total_count` and future aggregates must reflect the permission-filtered query.

Do not run an unrestricted count followed by a restricted data query.

## Query cost controls

The new engine must add explicit controls before feature breadth.

Recommended configurable limits:

```text
QUERY_MAX_RELATION_DEPTH=4
QUERY_MAX_RELATION_NODES=30
QUERY_MAX_FIELDS=150
QUERY_MAX_FILTER_DEPTH=10
QUERY_MAX_FILTER_NODES=200
QUERY_MAX_IN_VALUES=200
QUERY_MAX_SORT_FIELDS=20
QUERY_MAX_AGGREGATES=20
QUERY_MAX_GROUP_FIELDS=8
QUERY_MAX_GROUP_ROWS=5000
QUERY_MAX_LIMIT=500
QUERY_MAX_OFFSET=1000000
```

Names/defaults may change during implementation, but every potentially multiplicative feature needs a bound.

Consider a simple internal cost score in addition to hard per-dimension limits. Example weights:

- scalar field: 1;
- to-one relation node: 5;
- to-many relation node: 10;
- relational filter hop: 10;
- aggregate expression: 5;
- deep nested limit/sort/filter: additional weight.

Reject clearly abusive plans before SQL execution.

## Error behavior

Keep fail-closed semantics.

Examples:

- unknown query parameter -> `INVALID_QUERY`;
- unknown field -> `INVALID_QUERY`;
- forbidden field -> not silently widened;
- unsupported relation shape -> explicit unsupported-query error;
- relation depth exceeded -> `QUERY_RELATION_DEPTH_LIMIT`;
- query cost exceeded -> `QUERY_COST_LIMIT`;
- invalid aggregate/group field -> `INVALID_QUERY`.

Do not silently ignore unsupported nested options because clients will otherwise believe the server applied restrictions that it actually ignored.

## Compatibility

Existing behavior must remain stable while the new planner is introduced:

- current `fields=*` semantics;
- current one-level `*.*` results;
- current filters;
- current multi-sort;
- current limit/offset;
- current legacy `expand` until formally deprecated;
- current response envelope;
- current permission behavior.

Prefer routing the old syntax through the new normalized query representation rather than maintaining two permanent query engines.

## Implementation phases

### Phase Q1 — Planner foundation

- introduce normalized query AST;
- move current scalar field/filter/sort/pagination behavior through it;
- keep output behavior unchanged;
- add planner-focused unit tests;
- keep legacy `expand` compatibility.

Exit criterion: existing query/RBAC suite passes unchanged through the new path.

### Phase Q2 — Deep to-one

- multi-depth M2O/O2O field selection;
- cycle/depth/node limits;
- batched level-by-level loading;
- permission checks at every hop;
- relational filter for to-one;
- relational sort for to-one.

Exit criterion: `fields=author.company.name` and equivalent permission-filtered queries work without N+1.

### Phase Q3 — To-many and M2M

- reverse O2M projection;
- managed M2M projection;
- relational `_some` / `_none` semantics;
- junction-safe loading;
- nested limits for to-many relations.

Exit criterion: common content/tag/comment models can be fetched in one bounded request with correct target RBAC.

### Phase Q4 — Search / aggregate / groupBy

- `search`;
- aggregate expressions;
- `groupBy`;
- permission-safe meta/aggregate responses;
- cardinality limits.

Exit criterion: dashboards and common reporting queries no longer require application-side full-dataset scans.

### Phase Q5 — `deep` and selected functions

- strict nested query options;
- date extraction/grouping helpers if required;
- final Directus-style compatibility examples;
- performance regression suite.

## Required test matrix

At minimum cover:

- admin vs ordinary vs Public;
- source readable / target forbidden;
- source field allowed / target field hidden;
- source and target row filters simultaneously;
- M2O/O2O/O2M/M2M;
- missing related records;
- cycles;
- max depth exactly at and above limit;
- wildcard expansion under field allowlists;
- relational filter with permission filter;
- to-one relational sort;
- aggregate/group results with hidden rows;
- search with hidden fields;
- SQL metacharacters and LIKE wildcard escaping;
- large IN lists;
- worst-case deep query rejected before expensive execution;
- query count assertions to catch N+1 regressions;
- real MySQL integration tests with realistic indexes/data sizes.

## Performance requirements

Do not define success only as "the query returns the right JSON".

For representative seeded datasets measure:

- SQL statement count;
- rows examined where practical;
- p50/p95 latency;
- response size;
- heap growth;
- behavior at max configured relation depth/limit.

Any deep-query implementation that turns 100 source rows into hundreds of SQL round trips is not acceptable even if functionally correct.

## Deliberate non-goals

For this roadmap:

- no GraphQL;
- no arbitrary SQL expression parameter;
- no unbounded `limit=-1` public escape hatch;
- no implicit to-many sort semantics;
- no ORM introduction;
- no permission enforcement only in Studio/routes;
- no attempt at exact Directus response compatibility where YunCMS already has a stable documented contract.

## Definition of done

This roadmap is complete when normal YunCMS clients can perform deep, permission-safe application queries across to-one/to-many/M2M relations; filter/sort common relational paths; search; aggregate/group data; and use bounded nested query controls without bypassing RBAC or causing N+1/unbounded SQL behavior.
