# Environment / Manual TODO

This file contains only work that cannot be completed or truthfully verified from the current GitHub-connector environment. Product roadmap work belongs in `plan.md`.

## Next Codex/local-machine session

- [ ] Clone/switch to branch `16-08-2026` and run `npm install`. Commit the generated `package-lock.json` if dependency resolution succeeds without unexpected major-version drift.
- [ ] Confirm the local runtime is Node.js 24 LTS with `node --version`. Do not continue on an EOL Node release.
- [ ] Run all non-MySQL tests with `npm test` after dependencies are installed. Fix actual failures before checking related `plan.md` verification items.
- [ ] Run Studio build with `npm run build --workspace=@yuncms/studio`.
- [ ] Run `node packages/cli/bin/yuncms.js help` and verify only actually implemented CLI commands are advertised as available.
- [ ] Confirm the API refuses to listen on an unbootstrapped database with `DATABASE_MIGRATION_REQUIRED` rather than silently creating application schema at startup.
- [ ] Run `npm run bootstrap` on a disposable MySQL database and then start the API; verify `/health` returns process health and `/ready` reports MySQL readiness accurately.
- [ ] Before auth is implemented, call a generic `/items/<existing-collection>` route and confirm the role-less public request fails closed with HTTP 403/canonical `FORBIDDEN` error rather than exposing data.
- [ ] Verify unknown routed errors do not expose stack traces, DB messages or secrets in HTTP responses; confirm request ids correlate with server logs.

## Real MySQL required

Use a disposable local MySQL 8 database; do not point early bootstrap/schema/CRUD/RBAC tests at production data.

### Bootstrap and schema

- [ ] Create an empty database and a least-privilege test user able to create/alter/drop tables inside that database.
- [ ] Copy `.env.example` to `.env` and fill the MySQL connection values.
- [ ] Verify `mysql2/promise` can connect and `SELECT 1` succeeds.
- [ ] Run `bootstrapDatabase()`/`npm run bootstrap` against the empty database, then run it a second time and verify the second run reports no newly applied migration and changes nothing destructive.
- [ ] Inspect `yuncms_schema_migrations`, `yuncms_schema_state`, `yuncms_collections`, `yuncms_fields`, `yuncms_relations`, auth/file/audit system tables and their indexes/FKs after bootstrap.
- [ ] Verify the schema advisory lock with two independent Node processes; only one schema mutation should own `yuncms:schema` at a time and lock timeout must fail cleanly.
- [ ] Create two disposable collections through `CollectionsService`; confirm physical MySQL tables, `id CHAR(36)` primary keys and metadata rows agree.
- [ ] Update safe collection metadata and verify only metadata changes while schema version increments once.
- [ ] Add representative primitive fields through `FieldsService` (`string`, `integer`, `decimal`, `boolean`, `date/datetime`, `json`, `uuid`) and compare `INFORMATION_SCHEMA` with `yuncms_fields`.
- [ ] Update field UI metadata (`hidden`, `readonly`, `sort`, `interface`, `options`) and confirm physical column definitions are unchanged while schema version increments once.
- [ ] Create an M2O through `RelationsService` and verify the physical FK, metadata row, target type validation and `RESTRICT`/`CASCADE`/valid `SET NULL` behavior.
- [ ] Verify `readO2M()` returns inverse metadata for the target collection without creating a second physical FK.
- [ ] Delete the M2O through `deleteM2O()` and verify both physical FK and metadata disappear; force metadata-delete failure and confirm FK restoration is attempted.
- [ ] Force a metadata failure after physical collection/field/FK creation and verify compensation removes the newly created physical object instead of leaving silent drift.
- [ ] Verify every successful schema mutation increments `yuncms_schema_state.version` exactly once and failed/compensated mutations do not increment it.
- [ ] Verify `SchemaCache` reloads after a committed version increment and does not observe an uncommitted metadata/version pair.
- [ ] Run real-MySQL integration tests for transactions, rollback, duplicate-key normalization, FK behavior, advisory schema locking, deadlock retry, concurrent DDL and schema metadata/physical-schema consistency.

### Generic CRUD/query compiler

- [ ] Create records through `ItemsService` using explicit system accountability and verify generated UUID primary keys, required/read-only behavior and placeholder-bound values.
- [ ] Verify `readManyWithMeta()` fields/filter/sort/limit/offset/count against real MySQL, including `_and/_or`, `_in/_nin`, NULL and escaped LIKE cases.
- [ ] Attempt SQL-injection payloads through collection names, field selection, sort, filter operators and values; identifiers/operators must fail closed and values must remain data parameters.
- [ ] Verify `createMany()` rolls back the whole transaction when a later row fails.
- [ ] Verify `updateMany()` and `deleteMany()` reject missing/empty caller filters even for admin/system accountability.
- [ ] Verify `/items/:collection` REST responses/error shapes after auth test wiring exists; until then only verify the expected fail-closed 403 behavior.

### Roles and permissions

- [ ] Create an ordinary role and separate `read/create/update/delete` permission rows against a disposable collection; verify each missing action permission is denied independently.
- [ ] Give a read permission only `id,title` fields plus server row filter `status = active`; verify only active rows are returned and `status` cannot be selected, sorted or used in a caller filter.
- [ ] Verify write field allowlists reject payload keys not granted for create/update.
- [ ] Verify update/delete permission row filters prevent touching rows outside the allowed scope, including single-item operations by id.
- [ ] Verify a normal role cannot use `RolesService`/permission management APIs that require administrator/system accountability.
- [ ] Verify explicit system/admin accountability bypasses ordinary permission rows, while `public + role:null` and a role with no matching permission both fail closed.
- [ ] Verify malformed/stale permission metadata fails safely rather than broadening access.
- [ ] Keep permission `validation` null for now; confirm attempts to store validation metadata fail with `PERMISSION_VALIDATION_NOT_READY` until enforcement is implemented.

## npm/package publishing decisions

Do not publish from this environment.

- [ ] Confirm which npm scope/name YunCMS will own before public package names are considered stable (`yuncms`, `@yunsoft/*`, `@yuncms/*`, etc.). Internal workspace names may be renamed before first publish.
- [ ] Confirm npm authentication and organization permissions.
- [ ] Run `npm pack` for publishable packages and inspect package contents before any `npm publish`.
- [ ] Only after the CLI/bootstrap milestone is functional, test installation from a packed tarball in a brand-new directory so the setup flow is tested like a real user would install it.

## Manual security/production checks for later milestones

- [ ] Run full auth/RBAC integration tests with separate admin, normal-role, explicit public-role and role-less identities against real MySQL after authentication is implemented.
- [ ] Test schema mutations concurrently from two processes, not only two promises in one process.
- [ ] Test graceful shutdown while requests and a DB transaction are active.
- [ ] Test local file storage permissions/path traversal once FilesService lands.
- [ ] Test S3-compatible storage against the actual provider intended for production once that driver lands.
