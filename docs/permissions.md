# Roles and Permissions

This document describes RBAC behavior implemented on branch `16-08-2026`.

## Accountability

Authorization starts from explicit accountability passed to services.

Important invariants:

- `null` user/role never means administrator;
- role-less public accountability is not granted item access;
- system/admin bypass is explicit;
- session/API-token authentication resolves the user's current role before service execution;
- trusted extensions that instantiate services with request service options inherit the same accountability and request-local permission cache.

## RolesService

Role management is administrator/system-only and supports list/read/create/update/delete.

Protected invariants:

- one role cannot be both admin and public;
- only one public role may exist;
- MySQL also enforces the one-public-role rule;
- protected admin/public semantics cannot be silently mutated;
- roles still referenced by users/permissions cannot be deleted through an unsafe shortcut.

## Permission records

A permission is scoped to:

```text
role + collection + action
```

Actions:

- `create`
- `read`
- `update`
- `delete`

A permission may contain:

- field allowlist;
- server-side row filter;
- create/update prospective-record validation JSON.

Filters and validations use the same allowlisted field/operator language as the generic query layer.

## Resolution and request-local cache

`PermissionsService.resolve(action, collection)`:

1. gives explicit admin/system accountability full access;
2. denies non-admin accountability without a role;
3. resolves the exact role/collection/action row;
4. denies missing permission rows;
5. rejects malformed metadata;
6. caches the resolved result only inside the current request context.

The cache is intentionally request-local, so there is no cross-process stale-permission cache to invalidate. Permission mutations clear the current request cache.

## Field and row enforcement

`ItemsService` enforces permissions inside the service layer.

Reads:

- selected fields must be readable;
- sort/filter fields must be readable;
- permission row filter is compiled against the full collection schema;
- caller filter is compiled against the caller-visible schema;
- both filters are combined with `AND`.

Writes:

- payload fields must exist, be writable and belong to the action field allowlist;
- update/delete also apply the permission row filter;
- bulk update/delete additionally require an explicit non-empty caller filter.

## Create/update validation

Validation is evaluated against the **prospective final record**, not merely the incoming patch.

Create:

- generated primary key + provided values + known schema defaults form the candidate record;
- the candidate must satisfy the permission validation rule before insert.

Update:

- current persisted row is loaded within the allowed update scope;
- patch is applied in memory to form the candidate final row;
- validation runs against that final row before update.

Bulk update:

- candidate rows are inspected before mutation;
- V1 refuses to validate more than 5,000 matching rows in one call rather than silently skipping validation.

A validation failure returns `VALIDATION_FAILED`; the bulk guard returns `VALIDATION_BULK_LIMIT`.

## Relation expansion

Direct M2O expansion also honors RBAC:

- source relation field must be visible under source read permission;
- target records are loaded through `ItemsService` with the same accountability;
- target field allowlists/row filters remain effective;
- inaccessible targets resolve to `null` rather than bypassing target restrictions.

## Management REST

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

The Studio exposes role CRUD plus field/filter/validation editing.

## Remaining verification

Source-level enforcement exists. Real MySQL/API privilege-escalation, validation, cache and relation-expansion tests remain in `todo.md` and must pass before production release.
