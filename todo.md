# Environment / Manual TODO

This file contains only work that cannot be truthfully verified from the GitHub-connector environment. Source/product roadmap work belongs in `plan.md`.

## 1. Fresh checkout / dependency graph

- [x] Switch to branch `16-08-2026` and confirm a clean working tree.
- [x] Confirm Node.js 24 LTS with `node --version`.
- [x] Run `npm install`; review `mysql2`, Express, React/Vite, AWS SDK and Nodemailer resolution.
- [x] Review and commit the generated `package-lock.json` only after install succeeds without unintended dependency drift.
- [x] Run `npm test`; fix real failures before checking any milestone.
- [x] Run `npm run build --workspace=@yunsoft/yuncms-studio`.
- [x] Run CLI help and confirm `init`, `bootstrap`, `start`, `help` only.
- [x] Run `yuncms start`/workspace equivalent and verify child API keeps project cwd/env and shuts down cleanly.

## 2. Disposable MySQL 8 bootstrap

Use disposable test data only.

- [x] Create a least-privilege test DB user scoped to the YunCMS test database with required dynamic-DDL permissions.
- [x] Copy `.env.example` to `.env`; configure test DB.
- [x] Verify `mysql2/promise` connectivity and `SELECT 1`.
- [x] Confirm API refuses to listen on an unbootstrapped DB with `DATABASE_MIGRATION_REQUIRED`.
- [x] Run `yuncms bootstrap`; verify migrations `0001`–`0004` journal exactly once.
- [x] Run bootstrap again and verify idempotent/no destructive change.
- [x] Inspect core `yuncms_*` tables, indexes, FKs and schema-state row.
- [x] Start API after bootstrap; verify `/health` and `/ready`.
- [x] Confirm request ids correlate with structured JSON logs.

## 3. Dynamic schema / compensation / concurrency

- [x] Verify non-admin/non-system accountability cannot access schema services or `/schema` routes.
- [x] Create collections and compare metadata with `INFORMATION_SCHEMA` including `id CHAR(36)` PK.
- [x] Create each supported primitive field family; compare physical column and metadata.
- [x] Verify metadata-only collection/field updates do not change physical schema.
- [x] Verify field required/null/default/index mutations against real MySQL.
- [x] Force field ALTER/index partial failure and verify compensation restores prior state without false schema-version increment.
- [x] Verify `SET NULL` relation fields cannot be made required.
- [x] Create/delete M2O; verify physical FK, metadata and restore compensation.
- [x] Create M2M; verify junction table, two FKs, unique pair, two relation records and one schema-version increment.
- [x] Delete M2M through `DELETE /schema/relations/m2m/:junction?destructive=true`; verify tombstone rename, metadata removal and final DROP.
- [x] Force M2M metadata failure after tombstone rename and verify original junction table/data is restored.
- [x] Verify collection/field delete requires explicit destructive intent and refuses system/related objects.
- [x] Force collection/field metadata failure and verify tombstone restore with data intact.
- [x] Force final tombstone cleanup failure and confirm explicit `SCHEMA_PARTIAL_FAILURE` drift details.
- [x] Verify each successful schema mutation increments version exactly once and failed/compensated mutations do not.
- [x] Verify `SchemaCache` observes only committed metadata/version pairs.
- [x] Run concurrent schema mutations from two independent Node processes; verify `yuncms:schema` advisory serialization/timeouts.
- [x] Exercise deadlock/lock-wait retry behavior against real MySQL.

## 4. Generic CRUD / query / direct relation expansion

- [x] Create/read/update/delete records through service and REST with explicit admin/system accountability.
- [x] Verify UUID generation, required/read-only/default behavior.
- [x] Verify fields/filter/sort/limit/offset/count against real MySQL.
- [x] Cover `_and/_or`, `_in/_nin`, NULL and escaped LIKE cases.
- [x] Attempt SQL injection through collection/field/sort/operator/value inputs; identifiers/operators must fail closed and values remain parameters.
- [x] Verify `createMany()` fully rolls back when a later row fails.
- [x] Verify bulk update/delete reject empty/missing caller filters.
- [x] Verify `expand=<m2o_field>` replaces the FK with a readable target record.
- [x] Verify source hidden/forbidden relation fields cannot be inferred via `expand`.
- [x] Verify target row filters/field allowlists apply during expansion and inaccessible target rows become `null` rather than bypassing RBAC.
- [x] Verify M2M/O2M expansion fails with the documented unsupported response rather than inventing nested data.
- [x] Verify filter hooks run before validation/mutation and thrown filters prevent writes.
- [x] Verify action hooks run only after successful mutation/commit; bulk-create actions run after the transaction commits.
- [x] Verify recursive hook chains stop at `HOOK_RECURSION_LIMIT` without affecting unrelated requests.

## 5. Authentication / sessions / recovery

- [x] Run `yuncms init`; verify first admin creation and rerun does not silently create another admin.
- [x] Verify valid login plus unknown-user/bad-password/inactive-user identical public credential behavior.
- [x] Verify access/session expiry and disabled-user behavior.
- [x] Verify refresh rotates both credentials; old refresh replay fails.
- [x] Run concurrent refresh with the same token and verify only one succeeds.
- [x] Verify logout-current and logout-all semantics.
- [x] Change a password and confirm all sessions revoke transactionally.
- [x] Create/list/revoke API tokens; verify secrets/hashes do not appear in list responses and disabled owner disables token auth.
- [x] Verify reset token replacement, one-time consumption, sibling-token removal, session revocation and replay/expiry/wrong-prefix failure.
- [x] Verify email verification is self/admin/system-only, consumes once and sets `email_verified_at`.
- [x] Confirm every `/auth/*` response carries `Cache-Control: no-store`.

### SMTP delivery

- [x] Configure a disposable SMTP/test mailbox and verify reset mail delivery.
- [x] Confirm reset-request response is indistinguishable for active/nonexistent email addresses.
- [x] Confirm raw reset/verification tokens never appear in public request responses or structured logs.
- [x] Follow Studio reset link, change password and confirm token query params are removed after completion.
- [x] Send verification from Users UI, follow link and verify account state.
- [x] Simulate SMTP failure; confirm unrelated API startup/traffic remains available and failure logging is redacted.

### Rate limits

- [x] Exceed login/refresh/action limits and verify HTTP 429, `Retry-After` and rate-limit headers.
- [x] Confirm a new window restores access.
- [x] Before multi-instance production, explicitly decide whether process-local limits are acceptable; if not, implement a shared limiter as a separate scale follow-up.

## 6. Roles / permissions / validation

- [x] Create a normal role and separate create/read/update/delete permission rows.
- [x] Verify each missing action permission denies independently.
- [x] Verify field allowlists block selection/filter/sort/write inference.
- [x] Verify server row filters restrict read/update/delete including single-item-by-id paths.
- [x] Verify prospective create/update validation rejects final records that fail the rule.
- [x] Verify update validation evaluates current row + patch, not patch alone.
- [x] Verify bulk validation checks every prospective row and fails closed above the 5,000-row safety cap.
- [x] Verify request-local permission cache removes duplicate resolution inside one request without leaking across requests/processes.
- [x] Verify permission mutation clears the current request cache.
- [x] Verify explicit admin/system bypass, role-less public fail-closed and malformed/stale permission metadata fail safely.
- [x] Verify protected admin/public role rules and current-admin self-protection.

## 7. Studio end-to-end smoke

Run the built Studio against the disposable API/DB.

- [x] Login, automatic refresh/retry and logout.
- [x] Content primitive record create/edit/delete and loading/error/empty states.
- [x] Direct M2O picker uses readable labels and writes the target key correctly.
- [x] Test target collections with >200 records and confirm current picker limit is understood/documented; no claim of full search UX yet.
- [x] Data Model collection/field create/delete, required toggle, M2O create/delete, M2M create/delete.
- [x] Users create/role/status/self-protection/delete/verification-mail.
- [x] Roles/Permissions CRUD plus field/filter/validation editor.
- [x] Files upload/list/download/edit/delete.
- [x] Narrow-screen responsive behavior.
- [ ] Content: verify server-backed text search, multiple field filters, ascending/descending sort, header sort toggles, page-size changes and previous/next pagination against more than one page of records; confirm filtered `total_count` is accurate.
- [ ] Content: rapidly change search/filter/sort controls and verify stale responses never replace the newest result set.
- [ ] Files: verify type filters and newest/oldest/name/size sort presets in both Gallery and List; confirm switching view preserves the active controls.
- [ ] Users: verify collapsed `New user` flow plus search, role/status filters, sorting and reset without breaking inline role/status updates.
- [ ] Data Model: verify collection search/sort and field search/type/required sorting on a project with many collections/fields.
- [ ] Roles/Permissions: verify role search/sort, collection search and `Configured only` against roles with mixed permission coverage.
- [ ] Re-check the new control strips, filter chips, counters and pagination on narrow screens.
- [ ] Formal keyboard/focus/labels/screen-reader accessibility review.

## 8. Local storage + reconciliation

- [x] Verify `FILES_LOCAL_ROOT` ownership/permissions/persistence with the actual runtime user.
- [x] Upload binary/Unicode filenames; confirm UUID physical keys are independent from user names.
- [x] Verify MIME/content-length/content-disposition downloads.
- [x] Verify over-limit upload returns 413.
- [x] Attempt traversal/path-separator storage keys and confirm pre-filesystem rejection.
- [x] Force metadata insert failure after storage write and verify object cleanup.
- [x] Force storage delete failure after metadata deletion and confirm explicit cleanup error/log.
- [x] Run `POST /files/reconcile` dry-run and verify missing/orphan reporting.
- [x] Create a recent orphan object and confirm destructive reconciliation does not delete it before the age guard.
- [x] Create an old orphan object and confirm `deleteOrphans:true` deletes only the eligible orphan.
- [x] Verify missing storage objects do not cause YunCMS to auto-delete DB metadata.

## 9. S3-compatible provider + reconciliation

Use the actual provider intended for production.

- [ ] Configure bucket/region/endpoint/path-style/credentials as required.
- [ ] Upload/list/download/delete through `?storage=s3`.
- [ ] Verify credential-chain behavior when explicit keys are intentionally omitted.
- [ ] Run S3 reconciliation dry-run and age-guarded orphan cleanup.
- [ ] Exercise multi-page object inventory if possible and verify continuation handling.
- [ ] Test provider-specific behavior instead of assuming AWS/MinIO/R2 are identical.
- [ ] Force provider errors and confirm credentials/secrets are not leaked to clients/logs.

## 10. Audit / retention / logging / HTTP hardening

- [x] Verify item/file/schema mutation audit rows contain expected actor/action/collection/item/request id/timestamp.
- [x] Verify schema/file updates retain before/after metadata where implemented.
- [x] Put password/token/secret/authorization/api-key-shaped values in audited/logged metadata and confirm recursive `[REDACTED]` output.
- [x] Force audit write failure after committed mutation; confirm the committed operation still succeeds for the client while audit failure is logged.
- [x] Verify `/audit` access/pagination/filter behavior.
- [x] Run `/audit/cleanup` with a small batch; verify cutoff and bounded batch deletion.
- [x] Verify `complete=false` when max-batch guard is reached and rerun can continue cleanup.
- [x] Confirm cleanup does not run automatically merely because retention env values exist.
- [x] Confirm runtime output is valid line-delimited JSON at configured log levels.
- [x] Confirm `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Resource-Policy`, auth no-store and configured-origin CORS behavior.
- [x] Verify unexpected errors/DB messages/stacks/secrets are not exposed in HTTP responses.
- [ ] Configure HSTS at the real TLS/reverse-proxy layer and verify it there; YunCMS does not force HSTS without deployment context.

## 11. Extensions

- [x] Activate endpoint/hook examples and confirm local discovery/startup.
- [x] Confirm endpoint extensions mount only under `/extensions/<id>` after authentication.
- [x] Instantiate ItemsService/FilesService from context services + `serviceOptions(req)` and verify identical accountability/RBAC/storage behavior without self-HTTP/token forwarding.
- [x] Confirm extension services share request-local permission cache.
- [x] Verify `app.beforeStart` before listen and `app.afterStart` after listen.
- [x] Verify malformed manifest/root escape/unknown type/duplicate id/invalid export/type mismatch fail startup cleanly.
- [x] Pack/install a sample extension as an npm tarball and verify dependency discovery matches local behavior.

## 12. Graceful shutdown/runtime

- [x] Start active requests/DB work, send SIGTERM/SIGINT and verify graceful drain before force timeout.
- [x] Confirm DB pool closes once and startup failure also closes it.
- [x] Verify extension startup failure prevents a partially running API.
- [x] Verify SMTP outage does not prevent unrelated API startup.

## 13. npm/package release gate

The `@yunsoft` package family and first public release are documented in `docs/publishing.md`.

- [x] Check package naming availability and finalize publication under the owned `@yunsoft/*` npm organization.
- [x] If preferred scope is unavailable, verify the documented Yunsoft fallback names.
- [x] Confirm npm authentication/organization permissions.
- [x] Choose and add the public license before the first npm release.
- [x] Choose the first public package version.
- [x] Remove/adjust `private` package flags only after final public package structure is chosen.
- [x] Run `npm pack` for each publishable package and inspect contents/dependencies/bin.
- [x] Install packed tarballs in a brand-new directory.
- [x] From the packed install verify `npx yuncms init`, `npx yuncms bootstrap` and `npx yuncms start` as a real consumer.
- [x] Convert `docs/publishing.md` into the final user-facing npm installation guide only after the packed-install flow passes.
- [x] Publish only after all applicable release gates above pass.
