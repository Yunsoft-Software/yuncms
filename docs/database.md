# Database and Schema Engine

This document describes behavior that exists on branch `16-08-2026`. Planned schema operations are tracked in `plan.md` rather than documented here as shipped.

## Database scope

YunCMS V1 is intentionally MySQL-only and uses `mysql2/promise` directly. There is no ORM, query builder, second SQL dialect or GraphQL layer.

The pool disables multi-statements. Dynamic identifiers are validated and quoted separately from data values. Data values are passed through placeholders.

## Bootstrap

Run after configuring `.env`:

```bash
npm run bootstrap
```

The CLI checks Node.js 24, verifies the MySQL connection, obtains the `yuncms:bootstrap` advisory lock and applies required core migrations.

Bootstrap creates the migration journal plus the initial `yuncms_*` system tables. Re-running the same migration set is designed to be idempotent: already-journaled migrations are skipped.

The API itself does not bootstrap automatically. Before listening it performs a read-only compatibility check. A fresh/incomplete database causes startup to fail with `DATABASE_MIGRATION_REQUIRED`.

## Schema version

`yuncms_schema_state` contains the current dynamic schema version. Successful schema mutations increment it. The version is used as the cache key for schema snapshots.

Metadata changes and the version increment are committed together in a pinned MySQL transaction after the physical DDL succeeds. Because MySQL DDL is not treated as rollbackable application DML, service code uses best-effort compensation if metadata/version work fails after the physical change.

Schema mutations currently use the `yuncms:schema` MySQL advisory lock so multiple processes do not intentionally mutate the schema concurrently.

## Metadata tables

Current metadata tables:

- `yuncms_collections`
- `yuncms_fields`
- `yuncms_relations`
- `yuncms_schema_migrations`
- `yuncms_schema_state`

The initial bootstrap also creates user/session/role/permission/token/file/audit foundation tables for later milestones.

## CollectionsService

Implemented:

- list collections;
- read one collection;
- create a user collection;
- create an `id CHAR(36)` primary key with matching field metadata;
- reject the reserved `yuncms_` prefix;
- metadata-only updates for `note`, `singleton`, `hidden` and custom metadata;
- increment schema version only after metadata work succeeds;
- best-effort cleanup of a newly created table if metadata/version work fails.

Destructive collection delete is not implemented yet.

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

Create/read and metadata-only updates for `readonly`, `hidden`, `sort`, `interface` and `options` are implemented. Type conversion, index/null/default mutation and destructive delete are not yet shipped.

Defaults remain parameterized. Defaults for `TEXT` and `JSON` are intentionally postponed in the current compiler.

## RelationsService

M2O creation is implemented when:

- both collections already exist;
- the many-side field already exists;
- the target field is the target collection primary key;
- both metadata field types match;
- `ON DELETE` is one of `RESTRICT`, `CASCADE`, `SET NULL`;
- `SET NULL` is not used on a required many-side field.

The physical foreign key is created first. Relation metadata and schema-version increment are then committed together. If the metadata step fails, YunCMS attempts to remove the newly created FK.

M2O deletion is implemented with the inverse compensation strategy: YunCMS drops the FK, removes metadata and increments schema version transactionally, and attempts to recreate the FK if the metadata transaction fails. O2M is currently exposed as inverse metadata reads over matching M2O records.

M2M junction creation is still pending.

## Schema cache

`SchemaCache` stores a schema snapshot keyed by `yuncms_schema_state.version`. It can briefly reuse the last version check for a small TTL, then compares the database version before deciding whether to reload collection/field/relation metadata.

The important invariant is that failed metadata transactions do not advance the schema version, while committed schema metadata changes do.

## Items query and permission foundation

The query compiler validates requested fields and sort keys against schema metadata and only accepts an explicit filter-operator allowlist. Filter values, item values, limit and offset are bound as values rather than concatenated as raw user SQL.

`ItemsService` now resolves action permissions inside the service layer. A permission may restrict both fields and rows. User-provided select/filter/sort expressions are compiled against the permitted field view, while the server-side permission row filter is compiled against the full collection schema and ANDed with the user filter.

This prevents a role from using an inaccessible field as an inference side channel through filtering or sorting. Missing permission rows and role-less accountability fail closed. Explicit admin/system accountability bypasses ordinary permission rows.

Generic `/items/:collection` REST adapters are mounted, but the current API request context is still role-less public because authentication middleware is not implemented. Therefore ordinary HTTP item requests are intentionally denied until auth or explicit public-role wiring lands.

## Required real-MySQL verification

The connector environment cannot truthfully validate MySQL DDL, lock behavior, compensation or RBAC SQL behavior. `todo.md` contains the exact local/Codex checks that must be run against a disposable MySQL 8 database before those verification items can be marked complete.
