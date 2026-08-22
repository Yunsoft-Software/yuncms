# Query Engine — Remaining Source Work

Target baseline: `22-08-2026`.

This file is intentionally a **remaining-work list**, not a history of completed work. Completed query-engine roadmap items have been removed.

The shipped query contract is documented in [`api-query-language.md`](api-query-language.md).

## Current boundary

The branch already has bounded scalar filters/sorts, search, aggregates/grouping, query-cost limits, `items.query` revalidation, recursive relation field projection, reverse O2M/O2O projection, managed M2M traversal and per-hop RBAC.

The remaining gap is query predicates/order/options that operate *through* relation paths rather than merely projecting related records.

## Q1 — Permission-aware relational filtering

- [ ] Support common direct to-one relation filters, for example:

```json
{
  "author_id": {
    "name": { "_eq": "Ada" }
  }
}
```

Required behavior:

- relation paths must resolve only through schema metadata;
- target collection read permission and target row filter must apply;
- unreadable target fields must fail closed;
- permission/user values remain parameterized;
- no raw SQL relation expression is accepted;
- `_and` / `_or` semantics remain correct when scalar and relational predicates are mixed;
- relation depth/node/query-cost budgets include filter traversal.

Implement to-one first. Add to-many relation predicates only after their SQL/query semantics and boundedness are explicit.

## Q2 — Permission-aware relational sorting

- [ ] Support common direct to-one sort paths such as:

```text
sort=author_id.name,-created_at
```

Required behavior:

- target field must be readable;
- target row permission cannot be bypassed by the join/order path;
- pagination must be applied **after** the effective relational ordering, not by sorting an already paginated result in memory;
- joins/aliases must come only from trusted schema metadata;
- duplicate/missing relation targets must have deterministic ordering semantics;
- sort relation hops contribute to query cost.

## Q3 — Bounded relation-local query options (`deep`)

- [ ] Add a normalized relation-local options object only after Q1/Q2 primitives are stable.

Target use cases:

```text
project related comments with their own filter/sort/limit
project related tags in deterministic order
```

Required behavior:

- strict normalized AST; never raw SQL;
- per-relation `filter`, `sort`, `limit` first;
- hard per-parent and total-row caps for to-many relations;
- full target RBAC at every hop;
- nested cost/depth accounting;
- deterministic behavior for M2O/O2O/O2M/M2M;
- no N+1 unbounded query loop.

Do not add arbitrary query functions/SQL expressions as part of this work. They are not a current product requirement.

## Definition of done

The remaining query roadmap is complete when relational filter, relational sort and bounded relation-local options work through the normalized schema/RBAC planner without changing the current scalar query behavior or weakening query-cost/security boundaries.

Real MySQL/performance regression checks for these and the already-shipped relation engine belong in `todo.md`, not in this source roadmap.
