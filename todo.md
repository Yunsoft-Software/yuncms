# Environment / Manual TODO

This file contains only work that cannot be completed or truthfully verified from the current GitHub-connector environment. Product roadmap work belongs in `plan.md`.

## Next Codex/local-machine session

- [ ] Clone/switch to branch `16-08-2026` and run `npm install`. Commit the generated `package-lock.json` if dependency resolution succeeds without unexpected major-version drift.
- [ ] Confirm the local runtime is Node.js 24 LTS with `node --version`. Do not continue on an EOL Node release.
- [ ] Run all non-MySQL tests with `npm test` after dependencies are installed. Fix actual failures before checking related `plan.md` verification items.
- [ ] Run Studio build with `npm run build --workspace=@yuncms/studio`.
- [ ] Confirm the API refuses to listen on an unbootstrapped database with `DATABASE_MIGRATION_REQUIRED` rather than silently creating application schema at startup.
- [ ] After bootstrapping the test DB, run the API and verify `/health` returns process health and `/ready` reports MySQL readiness accurately.

## Real MySQL required

Use a disposable local MySQL 8 database; do not point early bootstrap/schema tests at production data.

- [ ] Create an empty database and a least-privilege test user able to create/alter/drop tables inside that database.
- [ ] Copy `.env.example` to `.env` and fill the MySQL connection values.
- [ ] Verify `mysql2/promise` can connect and `SELECT 1` succeeds.
- [ ] Run `bootstrapDatabase()` against the empty database, then run it a second time and verify the second run reports no newly applied migration and changes nothing destructive.
- [ ] Inspect `yuncms_schema_migrations`, `yuncms_schema_state`, `yuncms_collections`, `yuncms_fields`, `yuncms_relations`, auth/file/audit system tables and their indexes/FKs after bootstrap.
- [ ] Verify the schema advisory lock with two independent Node processes; only one schema mutation should own `yuncms:schema` at a time and lock timeout must fail cleanly.
- [ ] Create two disposable collections through `CollectionsService`; confirm physical MySQL tables, `id CHAR(36)` primary keys and metadata rows agree.
- [ ] Add representative primitive fields through `FieldsService` (`string`, `integer`, `decimal`, `boolean`, `date/datetime`, `json`, `uuid`) and compare `INFORMATION_SCHEMA` with `yuncms_fields`.
- [ ] Create an M2O through `RelationsService` and verify the physical FK, metadata row, target type validation and `RESTRICT`/`CASCADE`/valid `SET NULL` behavior.
- [ ] Force a metadata failure after physical collection/field/FK creation and verify compensation removes the newly created physical object instead of leaving silent drift.
- [ ] Verify every successful schema mutation increments `yuncms_schema_state.version` exactly once and failed/compensated mutations do not increment it.
- [ ] Run real-MySQL integration tests for transactions, rollback, duplicate-key normalization, FK behavior, advisory schema locking, deadlock retry, concurrent DDL and schema metadata/physical-schema consistency as those tests are added.

## npm/package publishing decisions

Do not publish from this environment.

- [ ] Confirm which npm scope/name YunCMS will own before public package names are considered stable (`yuncms`, `@yunsoft/*`, `@yuncms/*`, etc.). Internal workspace names may be renamed before first publish.
- [ ] Confirm npm authentication and organization permissions.
- [ ] Run `npm pack` for publishable packages and inspect package contents before any `npm publish`.
- [ ] Only after the CLI/bootstrap milestone is functional, test installation from a packed tarball in a brand-new directory so the setup flow is tested like a real user would install it.

## Manual security/production checks for later milestones

- [ ] Run auth/RBAC integration tests with separate admin, normal-role, and public identities against real MySQL.
- [ ] Test schema mutations concurrently from two processes, not only two promises in one process.
- [ ] Test graceful shutdown while requests and a DB transaction are active.
- [ ] Test local file storage permissions/path traversal once FilesService lands.
- [ ] Test S3-compatible storage against the actual provider intended for production once that driver lands.
