# Roles and Permissions

This document describes RBAC behavior implemented on branch `21-08-2026`.

## Accountability

Authorization starts from explicit accountability passed to services.

Important invariants:

- `null` user/role never means administrator;
- role-less public accountability is not granted item access;
- system/admin bypass is explicit;
- session/API-token authentication resolves the user's current role before service execution;
- trusted extensions that instantiate services with request service options inherit the same accountability and request-local permission cache.

## RolesService

Roles use the same explicit permission engine as other permission-managed resources. `yuncms_roles` starts with no grant for Public or ordinary roles, but an administrator may explicitly grant `read`, `create`, `update` or `delete`. Admin/system accountability bypasses the permission lookup as before.

Role mutation still keeps data-integrity and escalation invariants separate from the grant itself:

- one role cannot be both admin and public;
- only one public role may exist;
- MySQL also enforces the one-public-role rule;
- a delegated role manager cannot mint a new Administrator or Public role as a side effect of ordinary Roles create access;
- Administrator/Public roles cannot be deleted through the ordinary delegated role API;
- roles still referenced by users cannot be deleted through an unsafe shortcut.

These are record semantics, not role-type permission locks. Normal role CRUD becomes available whenever the exact permission row exists.

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

A normal project-collection permission may contain:

- field allowlist;
- server-side row filter;
- create/update prospective-record validation JSON.

Filters and validations use the same allowlisted field/operator language as the generic query layer.

## Permission-managed system resources

Core migration `0007-system-permission-resources` registers a deliberately small set of system resources in schema metadata. Migration `0011-role-permission-actions` expands Roles to the same explicit CRUD-grant model. This does **not** expose generic `/items/yuncms_*` CRUD; specialized services remain the execution path.

| Resource | Explicitly grantable actions | Advanced field/row rules |
| --- | --- | --- |
| `yuncms_users` | read, create, update, delete | No; action-level only |
| `yuncms_files` | read, create, update, delete | No; action-level only |
| `yuncms_roles` | read, create, update, delete | No; action-level only |

Everything else under the system schema stays non-delegatable unless it is explicitly registered in a future migration. In particular, permission records themselves are not a delegatable system resource.

Public and ordinary roles follow the same model: **deny by default, explicit grant to enable**. There is no separate blanket rule that says “Public can never access this permission-managed resource” or “custom roles can only read Roles.” This allows intentional cases such as a public image gallery backed by `yuncms_files:read`, or a narrowly trusted role-management client backed by explicit Roles actions.

Additional safety rules:

- no Public/custom system-resource access exists until an administrator creates the exact permission row;
- grants cannot expose non-permission-managed system collections;
- a delegated user manager cannot assign the Administrator role or modify/delete Administrator accounts;
- the Public role cannot be assigned to an authenticated user;
- delegated Roles create cannot create Administrator/Public roles;
- Administrator/Public roles retain protected deletion semantics;
- Permissions management itself remains administrator/system-only;
- generic `ItemsService` refuses system collections and requires the dedicated service.

Because current system-resource permissions are action-level only, grant a system-resource action only when exposing that specialized action is intentional. For example, `yuncms_files:read` permits the normal Files read/list/content path; leaving the permission absent keeps Files private.

The Studio permission matrix shows explicitly permission-managed system resources and every action their metadata exposes. Public uses the same matrix as other non-admin roles rather than receiving an artificial blanket lock.

## Resolution and request-local cache

`PermissionsService.resolve(action, collection)`:

1. gives explicit admin/system accountability full access;
2. denies non-admin accountability without a role;
3. for system collections, requires explicit `permissionManaged` registration and an allowed action;
4. resolves the exact role/collection/action row, including for Public;
5. denies missing permission rows;
6. rejects malformed metadata;
7. caches the resolved result only inside the current request context.

The cache is intentionally request-local, so there is no cross-process stale-permission cache to invalidate. Permission mutations clear the current request cache.

## Field and row enforcement

`ItemsService` enforces project-collection permissions inside the service layer.

Reads:

- selected fields must be readable;
- sort/filter fields must be readable;
- permission row filter is compiled against the full collection schema;
- caller filter is compiled against the caller-visible schema;
- both filters are combined with `AND`.

Writes:

- payload fields must exist, be writable and belong to the action field allowlist;
- update/delete also apply the permission row filter;
- bulk update/delete additionally require an explicit non-empty caller filter;
- system-managed accountability fields are generated by the service and cannot be supplied or directly changed by callers.

## Create/update validation

Validation is evaluated against the **prospective final record**, not merely the incoming patch.

Create:

- generated primary key + provided values + known schema defaults + system-managed accountability values form the candidate record;
- the candidate must satisfy the permission validation rule before insert.

Update:

- current persisted row is loaded within the allowed update scope;
- patch plus generated `updated_at`/`updated_by` values form the candidate final row;
- validation runs against that final row before update.

Bulk update:

- candidate rows are inspected before mutation;
- V1 refuses to validate more than 5,000 matching rows in one call rather than silently skipping validation.

A validation failure returns `VALIDATION_FAILED`; the bulk guard returns `VALIDATION_BULK_LIMIT`.

## Relation expansion

Direct to-one expansion also honors RBAC:

- source relation field must be visible under source read permission;
- `fields=*.*`, `relation.*` and `relation.field` use the same permission-aware direct relation engine as legacy `expand`;
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

The Studio exposes administrator role/permission management plus the permission matrix used to grant ordinary/Public access to permission-managed resources.

## Remaining verification

Source-level enforcement and regression coverage exist. Real MySQL/API privilege-escalation, Public Files, explicit Roles CRUD grants and system-resource delegation checks are kept in the guarded release integration suite and `todo.md` until executed against the target environment.
