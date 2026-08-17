# Database and Schema Engine

This document describes behavior implemented on branch `16-08-2026`. Planned or environment-dependent verification stays in `plan.md` / `todo.md` rather than being described as proven.

## Database scope

YunCMS V1 is intentionally MySQL-only and uses `mysql2/promise` directly. There is no ORM, query builder, second SQL dialect or GraphQL layer.

The pool disables multi-statements. Dynamic identifiers are validated/quoted separately from data values. Data values use placeholders.

## Bootstrap

After configuring `.env`:

```bash
npm run bootstrap
```

The CLI checks the supported Node runtime, verifies MySQL connectivity, obtains the `yuncms:bootstrap` advisory lock and applies required core migrations.

The API does not bootstrap implicitly. Before listening it performs a read-only compatibility check; an incomplete database fails startup with `DATABASE_MIGRATION_REQUIRED`.

## Schema authorization

`CollectionsService`, `FieldsService` and `RelationsService` require explicit administrator or system accountability for reads and mutations.

This check lives inside the services, not only in a future Studio/API route. A trusted extension therefore cannot use a normal user's accountability to bypass schema-management authorization by calling the services directly.

## Schema lock and version

Dynamic schema mutations use the MySQL advisory lock:

```text
yuncms:schema
```

`yuncms_schema_state.version` is incremented after each successful logical schema mutation. `SchemaCache` uses this version to decide when a snapshot must be reloaded.

MySQL DDL is not treated like rollbackable application DML. Physical changes and metadata therefore use explicit compensation strategies rather than pretending one transaction can undo every `ALTER TABLE`/`CREATE TABLE`/`DROP` operation.

## Metadata tables

Current schema metadata tables:

- `yuncms_collections`
- `yuncms_fields`
- `yuncms_relations`
- `yuncms_schema_migrations`
- `yuncms_schema_state`

Bootstrap also creates auth/RBAC/file/audit foundation tables.

## CollectionsService

Implemented:

- list/read collections;
- create user collections with `id CHAR(36)` primary key + matching field metadata;
- reject the reserved `yuncms_` prefix;
- metadata-only update for `note`, `singleton`, `hidden`, custom metadata;
- explicit destructive delete.

Collection delete requires:

```js
await collections.deleteOne('articles', { destructive: true });
```

System collections cannot be deleted. A collection with relation metadata is rejected until those relations are removed.

### Destructive delete compensation

Collection delete does not immediately drop the original table. Under the schema lock YunCMS:

1. renames the physical table to a generated tombstone name;
2. removes collection permissions + collection metadata in a transaction;
3. increments schema version in that same metadata transaction;
4. renames the tombstone back if metadata work fails;
5. drops the tombstone only after logical deletion commits.

If final tombstone cleanup itself fails, the operation reports `SCHEMA_PARTIAL_FAILURE` and includes the cleanup table name rather than silently hiding physical drift.

## FieldsService

Implemented physical field families:

- `integer` -> `INT`
- `bigint` -> `BIGINT`
- `decimal` -> validated `DECIMAL(precision, scale)`
- `string` -> validated `VARCHAR(length)`
- `text` -> `TEXT`
- `boolean` -> `TINYINT(1)`
- `date` -> `DATE`
- `datetime` -> `DATETIME(3)`
- `timestamp` -> `TIMESTAMP(3)`
- `json` -> `JSON`
- `uuid` -> `CHAR(36)`

Metadata-only update supports:

- `readonly`
- `hidden`
- `sort`
- `interface`
- `options`

Physical mutation is intentionally separate through `updateSchema()` and currently supports only:

- `required` / nullability;
- setting/changing supported defaults;
- `removeDefault: true`;
- engine-managed single-field index add/remove with `indexed`.

Type conversion is still disabled.

Example:

```js
await fields.updateSchema('articles', 'slug', {
  required: true,
  indexed: true,
});
```

Defaults for `TEXT` and `JSON` remain postponed. A many-side relation configured with `ON DELETE SET NULL` cannot be made required.

Physical field mutation stores the resulting structural metadata back into `yuncms_fields.schema_metadata` and increments schema version only after the metadata update succeeds. If metadata work fails after DDL, YunCMS attempts to restore the previous physical column/index definition.

### Field destructive delete

Field delete requires explicit `destructive: true`. Primary-key/system fields and fields participating in relation metadata are rejected.

YunCMS first renames the physical column to a tombstone name, removes field metadata + advances schema version, then drops the tombstone column. Metadata failure triggers an attempted rename back. Final cleanup failure is surfaced as `SCHEMA_PARTIAL_FAILURE` with the cleanup field name.

## RelationsService

### M2O

M2O creation requires:

- both collections exist and are non-system;
- many-side field exists;
- target is the target collection primary key;
- source/target metadata types match;
- `ON DELETE` is `RESTRICT`, `CASCADE` or structurally valid `SET NULL`.

The physical FK is created first. Relation metadata + schema version are then committed together. Metadata failure triggers best-effort FK removal.

M2O deletion drops the FK, removes relation metadata + advances schema version, and attempts to restore the FK if the metadata transaction fails.

O2M is represented as the inverse view of M2O metadata; there is no second physical FK.

### M2M

`createM2M()` creates an explicit junction collection under one schema lock. It creates:

- `id CHAR(36)` primary key;
- one required FK column for the left collection;
- one required FK column for the right collection;
- two physical FK constraints;
- a unique pair index preventing duplicate links;
- collection/field metadata for the junction;
- two relation metadata records marked as `m2m` sides;
- one schema-version increment for the logical operation.

Default junction FK behavior is `ON DELETE CASCADE`. `SET NULL` is rejected because junction FK fields are required.

Self-M2M is allowed only when explicit distinct junction field names are supplied; default names would collide and are rejected before DB access.

If metadata creation fails after the physical junction table exists, YunCMS attempts to remove any partial junction metadata and drops the newly created table.

M2M deletion as a single high-level helper is not implemented yet; its two relation records/junction collection should not be manually destroyed in production until that lifecycle is defined and verified.

## Schema cache

`SchemaCache` stores collection/field/relation snapshots keyed by `yuncms_schema_state.version`. Failed metadata transactions do not intentionally advance the version; committed logical schema changes do.

## Items/RBAC relationship

`ItemsService` uses schema metadata to validate fields, filters and sort keys. Permission row filters are compiled through the same safe query compiler and field-level permissions prevent inaccessible fields from being used for select/filter/sort inference.

Authenticated and explicit public accountability are already wired into the API. Missing permission records and role-less public access fail closed; administrator/system accountability is explicit.

## Required real-MySQL verification

The GitHub connector environment cannot truthfully prove MySQL DDL, advisory-lock, compensation or concurrent behavior. `todo.md` contains exact checks for:

- bootstrap/idempotency;
- collection/field creation;
- physical field mutation/index restoration;
- tombstone destructive-delete recovery/cleanup;
- M2O/O2M/M2M physical metadata consistency;
- concurrent schema lock behavior;
- CRUD/RBAC/auth/extension integration.

Do not mark those verification-dependent milestone items complete until they run against a disposable MySQL 8 database.
