# Architecture

## Scope

YunCMS is deliberately smaller than Directus. The architectural reference points we keep are the useful boundaries: a service layer behind HTTP, schema-aware generic item operations, dedicated services for system resources, explicit request accountability, and extension entrypoints that receive internal services/context.

We do not copy Directus source code and we do not preserve complexity solely for compatibility.

## Package boundaries

### `@yunsoft/yuncms-core`
Owns framework-independent backend primitives:
- environment/config parsing;
- the single `mysql2/promise` pool;
- transaction handling;
- MySQL error normalization/retry classification;
- safe SQL identifier validation.

Later this package will own schema metadata, services, auth/RBAC primitives, FilesService and audit behavior.

### `@yunsoft/yuncms-api`
Owns Express-specific behavior:
- server lifecycle;
- REST routes;
- request IDs;
- Studio CORS boundary;
- health/readiness adapters;
- later: authentication middleware, request context creation, service route adapters and extension endpoint mounting.

Business rules should not migrate into route handlers.

### `@yunsoft/yuncms-extensions-sdk`
Owns the public authoring surface for extensions. The first stable names are `defineEndpoint()` and `defineHook()`.

The package currently only validates and marks extension definitions. Discovery, lifecycle registration and runtime context injection are still pending.

### `@yunsoft/yuncms-studio`
A small React SPA. It must consume the public REST API and schema metadata rather than importing backend internals.

The current Studio only provides a shell and API health indicator. Content/Data Model/users/roles/files screens stay disabled until their backend contracts exist.

## Request flow target

```text
HTTP request
  -> authentication middleware
  -> request context/accountability
  -> thin route adapter
  -> service
  -> permission compiler
  -> query/schema layer
  -> mysql2 connection/transaction
```

Extensions join at service/lifecycle boundaries rather than making HTTP calls to the same process.

## Accountability

Authorization must be explicit. A future service context will distinguish:
- authenticated user/role;
- public access;
- internal/system access;
- administrator bypass.

`null` must never accidentally grant administrator privileges.

Permissions will be enforced in services, which means normal HTTP calls and extension service calls share the same authorization behavior by default.

## MySQL boundary

V1 intentionally supports one database family and one driver: MySQL through `mysql2/promise`.

Rules already represented in code:
- one shared pool factory;
- `multipleStatements: false`;
- values are expected to use parameter placeholders;
- dynamic identifiers must pass the identifier validator before quoting;
- transactions pin one pooled connection and always attempt rollback/release on failure;
- only deadlock/lock-wait classes are eligible for the generic bounded retry helper.

The dynamic schema engine will add stronger rules:
- resolve user-visible collection/field names through trusted metadata;
- serialize DDL with a MySQL advisory lock;
- keep physical schema + metadata changes coupled;
- increment schema version only after successful mutation;
- invalidate schema cache after commit.

## Dynamic schema target

System metadata tables describe user collections/fields/relations. The physical MySQL table remains the source of truth for data storage, while YunCMS metadata stores CMS behavior and relation/UI semantics that MySQL alone cannot express.

Initial schema services:
- `CollectionsService`
- `FieldsService`
- `RelationsService`

Initial relation model:
- M2O: physical foreign key;
- O2M: inverse metadata for an M2O;
- M2M: explicit junction collection.

We will not implement arbitrary type conversions/renames until data-loss and rollback semantics are defined and tested.

## Generic data target

`ItemsService` becomes the internal primitive for ordinary user collections. REST remains a wrapper around the same service.

The query language will support a small Directus-like subset (`fields`, `filter`, `sort`, `limit`, `offset`) with a strict allowlist of operators. Query values are bound parameters; collection/field/sort names are schema-resolved identifiers.

## Extensions target

The V1 extension runtime is trusted server-side JavaScript.

Two backend extension forms come first:
- endpoint extensions receive an Express router plus YunCMS context;
- hook extensions register filter/action/init callbacks.

Target context includes services, database/transaction access, schema getter, accountability, logger, env and emitter.

Untrusted plugin sandboxing/marketplace support is explicitly deferred.

## Studio target

Studio exists to make the engine practical, not to reproduce the full Directus Studio.

Initial useful screens, in dependency order:
1. Login.
2. Collections/content table + generic record form.
3. Data Model collection/field/relation forms.
4. Users.
5. Roles/permissions.
6. Files.

There is no visual flow/dashboard/ER diagram requirement in V1.

## Failure philosophy

YunCMS should fail closed and report actionable errors:
- unknown query operator => reject;
- unknown collection/field => reject;
- missing permission => reject;
- schema lock/DDL failure => do not pretend metadata succeeded;
- DB unavailable => `/ready` returns 503 while `/health` can still report a live process;
- retries are bounded and only used for explicitly retryable database failures.

Production milestones are not complete until the relevant behavior has been exercised against real MySQL.
