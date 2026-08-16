# Environment / Manual TODO

This file contains only work that cannot be truthfully verified from the GitHub-connector environment. Source/product roadmap work belongs in `plan.md`.

## 1. Fresh checkout / dependency graph

- [ ] Switch to branch `16-08-2026` and confirm a clean working tree.
- [ ] Confirm Node.js 24 LTS with `node --version`.
- [ ] Run `npm install`; review `mysql2`, Express, React/Vite, AWS SDK and Nodemailer resolution.
- [ ] Review and commit the generated `package-lock.json` only after install succeeds without unintended dependency drift.
- [ ] Run `npm test`; fix real failures before checking any milestone.
- [ ] Run `npm run build --workspace=@yuncms/studio`.
- [ ] Run CLI help and confirm `init`, `bootstrap`, `start`, `help` only.
- [ ] Run `yuncms start`/workspace equivalent and verify child API keeps project cwd/env and shuts down cleanly.

## 2. Disposable MySQL 8 bootstrap

Use disposable test data only.

- [ ] Create a least-privilege test DB user scoped to the YunCMS test database with required dynamic-DDL permissions.
- [ ] Copy `.env.example` to `.env`; configure test DB.
- [ ] Verify `mysql2/promise` connectivity and `SELECT 1`.
- [ ] Confirm API refuses to listen on an unbootstrapped DB with `DATABASE_MIGRATION_REQUIRED`.
- [ ] Run `yuncms bootstrap`; verify migrations `0001`–`0004` journal exactly once.
- [ ] Run bootstrap again and verify idempotent/no destructive change.
- [ ] Inspect core `yuncms_*` tables, indexes, FKs and schema-state row.
- [ ] Start API after bootstrap; verify `/health` and `/ready`.
- [ ] Confirm request ids correlate with structured JSON logs.

## 3. Dynamic schema / compensation / concurrency

- [ ] Verify non-admin/non-system accountability cannot access schema services or `/schema` routes.
- [ ] Create collections and compare metadata with `INFORMATION_SCHEMA` including `id CHAR(36)` PK.
- [ ] Create each supported primitive field family; compare physical column and metadata.
- [ ] Verify metadata-only collection/field updates do not change physical schema.
- [ ] Verify field required/null/default/index mutations against real MySQL.
- [ ] Force field ALTER/index partial failure and verify compensation restores prior state without false schema-version increment.
- [ ] Verify `SET NULL` relation fields cannot be made required.
- [ ] Create/delete M2O; verify physical FK, metadata and restore compensation.
- [ ] Create M2M; verify junction table, two FKs, unique pair, two relation records and one schema-version increment.
- [ ] Delete M2M through `DELETE /schema/relations/m2m/:junction?destructive=true`; verify tombstone rename, metadata removal and final DROP.
- [ ] Force M2M metadata failure after tombstone rename and verify original junction table/data is restored.
- [ ] Verify collection/field delete requires explicit destructive intent and refuses system/related objects.
- [ ] Force collection/field metadata failure and verify tombstone restore with data intact.
- [ ] Force final tombstone cleanup failure and confirm explicit `SCHEMA_PARTIAL_FAILURE` drift details.
- [ ] Verify each successful schema mutation increments version exactly once and failed/compensated mutations do not.
- [ ] Verify `SchemaCache` observes only committed metadata/version pairs.
- [ ] Run concurrent schema mutations from two independent Node processes; verify `yuncms:schema` advisory serialization/timeouts.
- [ ] Exercise deadlock/lock-wait retry behavior against real MySQL.

## 4. Generic CRUD / query / direct relation expansion

- [ ] Create/read/update/delete records through service and REST with explicit admin/system accountability.
- [ ] Verify UUID generation, required/read-only/default behavior.
- [ ] Verify fields/filter/sort/limit/offset/count against real MySQL.
- [ ] Cover `_and/_or`, `_in/_nin`, NULL and escaped LIKE cases.
- [ ] Attempt SQL injection through collection/field/sort/operator/value inputs; identifiers/operators must fail closed and values remain parameters.
- [ ] Verify `createMany()` fully rolls back when a later row fails.
- [ ] Verify bulk update/delete reject empty/missing caller filters.
- [ ] Verify `expand=<m2o_field>` replaces the FK with a readable target record.
- [ ] Verify source hidden/forbidden relation fields cannot be inferred via `expand`.
- [ ] Verify target row filters/field allowlists apply during expansion and inaccessible target rows become `null` rather than bypassing RBAC.
- [ ] Verify M2M/O2M expansion fails with the documented unsupported response rather than inventing nested data.
- [ ] Verify filter hooks run before validation/mutation and thrown filters prevent writes.
- [ ] Verify action hooks run only after successful mutation/commit; bulk-create actions run after the transaction commits.
- [ ] Verify recursive hook chains stop at `HOOK_RECURSION_LIMIT` without affecting unrelated requests.

## 5. Authentication / sessions / recovery

- [ ] Run `yuncms init`; verify first admin creation and rerun does not silently create another admin.
- [ ] Verify valid login plus unknown-user/bad-password/inactive-user identical public credential behavior.
- [ ] Verify access/session expiry and disabled-user behavior.
- [ ] Verify refresh rotates both credentials; old refresh replay fails.
- [ ] Run concurrent refresh with the same token and verify only one succeeds.
- [ ] Verify logout-current and logout-all semantics.
- [ ] Change a password and confirm all sessions revoke transactionally.
- [ ] Create/list/revoke API tokens; verify secrets/hashes do not appear in list responses and disabled owner disables token auth.
- [ ] Verify reset token replacement, one-time consumption, sibling-token removal, session revocation and replay/expiry/wrong-prefix failure.
- [ ] Verify email verification is self/admin/system-only, consumes once and sets `email_verified_at`.
- [ ] Confirm every `/auth/*` response carries `Cache-Control: no-store`.

### SMTP delivery

- [ ] Configure a disposable SMTP/test mailbox and verify reset mail delivery.
- [ ] Confirm reset-request response is indistinguishable for active/nonexistent email addresses.
- [ ] Confirm raw reset/verification tokens never appear in public request responses or structured logs.
- [ ] Follow Studio reset link, change password and confirm token query params are removed after completion.
- [ ] Send verification from Users UI, follow link and verify account state.
- [ ] Simulate SMTP failure; confirm unrelated API startup/traffic remains available and failure logging is redacted.

### Rate limits

- [ ] Exceed login/refresh/action limits and verify HTTP 429, `Retry-After` and rate-limit headers.
- [ ] Confirm a new window restores access.
- [ ] Before multi-instance production, explicitly decide whether process-local limits are acceptable; if not, implement a shared limiter as a separate scale follow-up.

## 6. Roles / permissions / validation

- [ ] Create a normal role and separate create/read/update/delete permission rows.
- [ ] Verify each missing action permission denies independently.
- [ ] Verify field allowlists block selection/filter/sort/write inference.
- [ ] Verify server row filters restrict read/update/delete including single-item-by-id paths.
- [ ] Verify prospective create/update validation rejects final records that fail the rule.
- [ ] Verify update validation evaluates current row + patch, not patch alone.
- [ ] Verify bulk validation checks every prospective row and fails closed above the 5,000-row safety cap.
- [ ] Verify request-local permission cache removes duplicate resolution inside one request without leaking across requests/processes.
- [ ] Verify permission mutation clears the current request cache.
- [ ] Verify explicit admin/system bypass, role-less public fail-closed and malformed/stale permission metadata fail safely.
- [ ] Verify protected admin/public role rules and current-admin self-protection.

## 7. Studio end-to-end smoke

Run the built Studio against the disposable API/DB.

- [ ] Login, automatic refresh/retry and logout.
- [ ] Content primitive record create/edit/delete and loading/error/empty states.
- [ ] Direct M2O picker uses readable labels and writes the target key correctly.
- [ ] Test target collections with >200 records and confirm current picker limit is understood/documented; no claim of full search UX yet.
- [ ] Data Model collection/field create/delete, required toggle, M2O create/delete, M2M create/delete.
- [ ] Users create/role/status/self-protection/delete/verification-mail.
- [ ] Roles/Permissions CRUD plus field/filter/validation editor.
- [ ] Files upload/list/download/edit/delete.
- [ ] Narrow-screen responsive behavior.
- [ ] Formal keyboard/focus/labels/screen-reader accessibility review.

## 8. Local storage + reconciliation

- [ ] Verify `FILES_LOCAL_ROOT` ownership/permissions/persistence with the actual runtime user.
- [ ] Upload binary/Unicode filenames; confirm UUID physical keys are independent from user names.
- [ ] Verify MIME/content-length/content-disposition downloads.
- [ ] Verify over-limit upload returns 413.
- [ ] Attempt traversal/path-separator storage keys and confirm pre-filesystem rejection.
- [ ] Force metadata insert failure after storage write and verify object cleanup.
- [ ] Force storage delete failure after metadata deletion and confirm explicit cleanup error/log.
- [ ] Run `POST /files/reconcile` dry-run and verify missing/orphan reporting.
- [ ] Create a recent orphan object and confirm destructive reconciliation does not delete it before the age guard.
- [ ] Create an old orphan object and confirm `deleteOrphans:true` deletes only the eligible orphan.
- [ ] Verify missing storage objects do not cause YunCMS to auto-delete DB metadata.

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

- [ ] Verify item/file/schema mutation audit rows contain expected actor/action/collection/item/request id/timestamp.
- [ ] Verify schema/file updates retain before/after metadata where implemented.
- [ ] Put password/token/secret/authorization/api-key-shaped values in audited/logged metadata and confirm recursive `[REDACTED]` output.
- [ ] Force audit write failure after committed mutation; confirm the committed operation still succeeds for the client while audit failure is logged.
- [ ] Verify `/audit` access/pagination/filter behavior.
- [ ] Run `/audit/cleanup` with a small batch; verify cutoff and bounded batch deletion.
- [ ] Verify `complete=false` when max-batch guard is reached and rerun can continue cleanup.
- [ ] Confirm cleanup does not run automatically merely because retention env values exist.
- [ ] Confirm runtime output is valid line-delimited JSON at configured log levels.
- [ ] Confirm `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Resource-Policy`, auth no-store and configured-origin CORS behavior.
- [ ] Verify unexpected errors/DB messages/stacks/secrets are not exposed in HTTP responses.
- [ ] Configure HSTS at the real TLS/reverse-proxy layer and verify it there; YunCMS does not force HSTS without deployment context.

## 11. Extensions

- [ ] Activate endpoint/hook examples and confirm local discovery/startup.
- [ ] Confirm endpoint extensions mount only under `/extensions/<id>` after authentication.
- [ ] Instantiate ItemsService/FilesService from context services + `serviceOptions(req)` and verify identical accountability/RBAC/storage behavior without self-HTTP/token forwarding.
- [ ] Confirm extension services share request-local permission cache.
- [ ] Verify `app.beforeStart` before listen and `app.afterStart` after listen.
- [ ] Verify malformed manifest/root escape/unknown type/duplicate id/invalid export/type mismatch fail startup cleanly.
- [ ] Pack/install a sample extension as an npm tarball and verify dependency discovery matches local behavior.

## 12. Graceful shutdown/runtime

- [ ] Start active requests/DB work, send SIGTERM/SIGINT and verify graceful drain before force timeout.
- [ ] Confirm DB pool closes once and startup failure also closes it.
- [ ] Verify extension startup failure prevents a partially running API.
- [ ] Verify SMTP outage does not prevent unrelated API startup.

## 13. npm/package release gate

Naming direction is already documented in `docs/publishing.md`; only real ownership/release verification remains.

- [ ] Check whether `yuncms` and the preferred `@yuncms/*` scope/packages can actually be owned/published from the intended npm account/org.
- [ ] If preferred scope is unavailable, verify the documented Yunsoft fallback names.
- [ ] Confirm npm authentication/organization permissions.
- [ ] Remove/adjust `private` package flags only after final public package structure is chosen.
- [ ] Run `npm pack` for each publishable package and inspect contents/dependencies/bin.
- [ ] Install packed tarballs in a brand-new directory.
- [ ] From the packed install verify `npx yuncms init`, `npx yuncms bootstrap` and `npx yuncms start` as a real consumer.
- [ ] Convert `docs/publishing.md` into the final user-facing npm installation guide only after the packed-install flow passes.
- [ ] Publish only after all applicable release gates above pass.
