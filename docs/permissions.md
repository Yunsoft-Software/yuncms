# Roles and Permissions

This document describes RBAC behavior currently implemented on branch `16-08-2026`.

## Accountability

Authorization starts from explicit accountability passed to services. The current shape carries user/role identity plus explicit `admin`, `public` and `system` flags.

Important defaults:

- `null` user/role never means administrator;
- role-less public accountability is not granted item access;
- system accountability is explicitly administrative;
- HTTP and future extensions use the same service-layer authorization path.

## RolesService

`RolesService` currently supports administrator/system-only:

- list roles;
- read one role;
- create a role.

Role rows contain `admin` and `public` flags, but automatic public-role assignment and authenticated request role resolution are not implemented yet.

## Permission records

`PermissionsService` uses one permission row per:

```text
role + collection + action
```

Current actions:

- `create`
- `read`
- `update`
- `delete`

A permission may contain:

- a field allowlist;
- a row filter expressed with the same safe filter language used by `ItemsService`.

Create/update validation metadata is intentionally rejected with `PERMISSION_VALIDATION_NOT_READY` until validation enforcement exists. YunCMS does not store a security policy it cannot yet enforce.

## Resolution behavior

`PermissionsService.resolve(action, collection)` behaves as follows:

1. explicit admin/system accountability receives full access;
2. non-admin accountability without a role is denied;
3. the exact `role + collection + action` permission row is loaded;
4. a missing row is denied;
5. malformed field metadata is rejected.

There is no implicit fallback permission.

## ItemsService enforcement

Authorization lives inside `ItemsService`, not only in Express middleware.

### Reads

For role-restricted reads:

- selected fields must be in the permission field allowlist;
- user sort fields must be in the permission field allowlist;
- user filter fields must be in the permission field allowlist;
- the permission's server-side row filter is compiled against the full schema;
- permission and caller row filters are combined with `AND`.

This distinction is deliberate. A role may be restricted by `status = active` without being allowed to read/filter/sort by the `status` field itself.

### Writes

Create/update payload fields must exist, must not be read-only and must be inside the action permission's field allowlist when one is present.

Update/delete actions also apply the permission row filter. Bulk update/delete additionally require an explicit non-empty caller filter so a generic bulk call cannot accidentally target every row merely because the permission filter exists.

## Current HTTP state

The API mounts generic item routes, but authentication middleware is still pending. Requests currently receive role-less public accountability, so item routes fail with `FORBIDDEN` by design.

Authenticated user resolution and explicit public-role assignment will be added with the authentication milestone rather than temporarily bypassing RBAC.

## Not implemented yet

- login/session-derived accountability;
- public-role discovery/assignment;
- permission create/update validation rules;
- effective-permission caching;
- permission update/delete management methods;
- hardened privilege-escalation regression suite against real MySQL;
- extension runtime propagation tests.

See `todo.md` for real-MySQL verification that must be completed before the RBAC milestone is considered production-ready.
