# Environment / Manual TODO

This file contains only work that cannot be completed or truthfully verified from the GitHub-connector environment. Product/source roadmap work belongs in `plan.md`.

## 1. Fresh local checkout / dependency graph

- [ ] Switch to branch `16-08-2026` and confirm the working tree is clean before validation.
- [ ] Confirm Node.js 24 LTS with `node --version`.
- [ ] Run `npm install` and review dependency resolution, including `mysql2`, `@aws-sdk/client-s3` and `nodemailer`.
- [ ] Commit the generated/reviewed `package-lock.json` only after dependency installation succeeds without unexpected major-version drift.
- [ ] Run `npm test` and fix real failures before marking any verification milestone complete.
- [ ] Run `npm run build --workspace=@yuncms/studio`.
- [ ] Run CLI help and confirm only shipped commands are advertised: `init`, `bootstrap`, `start`, `help`.
- [ ] Run `yuncms start`/the workspace equivalent and verify the child API process inherits the project cwd/environment and exits cleanly.

## 2. Disposable MySQL 8 bootstrap

Use a disposable database, never production data.

- [ ] Create a least-privilege test database user that can perform the DDL required inside only the YunCMS test database.
- [ ] Copy `.env.example` to `.env` and fill test DB values.
- [ ] Verify `mysql2/promise` connection and `SELECT 1`.
- [ ] Confirm the API refuses to listen on an empty/unbootstrapped DB with `DATABASE_MIGRATION_REQUIRED` rather than silently creating schema.
- [ ] Run `yuncms bootstrap`; confirm migrations `0001` through `0004` are journaled exactly once.
- [ ] Run bootstrap a second time and confirm it is idempotent/no-op.
- [ ] Inspect all core `yuncms_*` tables, indexes, FKs and `yuncms_schema_state`.
- [ ] Start API after bootstrap; verify `/health` and `/ready` semantics.
- [ ] Confirm request ids are returned and correlate with structured server logs.

## 3. Dynamic schema / DDL compensation

- [ ] Verify non-admin/non-system accountability cannot read or mutate Collections/Fields/Relations services or `/schema` routes.
- [ ] Create collections and confirm `id CHAR(36)` PK + metadata agree with `INFORMATION_SCHEMA`.
- [ ] Add each supported primitive field family and compare metadata vs physical columns.
- [ ] Verify metadata-only collection/field updates do not accidentally alter physical schema.
- [ ] Verify `FieldsService.updateSchema()` required/null/default/index behavior against real MySQL.
- [ ] Confirm `SET NULL` relations cannot be made required/not-null.
- [ ] Create/delete M2O and verify FK metadata/physical state plus restoration compensation.
- [ ] Create M2M and verify junction table, two FKs, unique pair and paired relation metadata.
- [ ] Delete M2M through the high-level destructive lifecycle; verify tombstone rename, metadata removal, schema-version increment and final DROP.
- [ ] Force M2M metadata failure after tombstone rename and verify the original junction table name/data is restored.
- [ ] Verify collection/field destructive delete refuses without `destructive=true` and refuses related/system objects.
- [ ] Force metadata failures during collection/field destructive delete and confirm tombstone objects restore with data intact.
- [ ] Force final tombstone cleanup failure and confirm `SCHEMA_PARTIAL_FAILURE` exposes the cleanup object rather than hiding drift.
- [ ] Verify every successful schema mutation increments schema version exactly once and failed/compensated mutations do not.
- [ ] Verify `SchemaCache` sees only committed version/metadata pairs.
- [ ] Run concurrent schema mutations from two independent Node processes and verify `yuncms:schema` advisory serialization/timeouts.
- [ ] Run deadlock/lock-wait retry scenarios against real MySQL.

## 4. Generic CRUD / query compiler

- [ ] Create/read/update/delete records through `ItemsService` and `/items` with explicit admin/system accountability.
- [ ] Verify UUID generation, required/read-only/default behavior.
- [ ] Verify `fields`, filters, sort, limit, offset and count metadata against real MySQL.
- [ ] Cover `_and/_or`, `_in/_nin`, NULL and escaped LIKE operators.
- [ ] Attempt SQL-injection payloads through collection names, field names, sort, filter operators and values; identifiers/operators must fail closed and values remain bound parameters.
- [ ] Verify `createMany()` rolls back the full transaction when a later row fails.
- [ ] Verify bulk update/delete reject empty/missing caller filters even for admin/system.
- [ ] Verify item filter hooks transform payload before validation/mutation and thrown filters prevent DB writes.
- [ ] Verify item action hooks run after successful mutation, and bulk-create actions only after transaction commit.
- [ ] Verify recursive hook chains stop at `HOOK_RECURSION_LIMIT` without affecting unrelated concurrent requests.

## 5. Authentication / sessions / recovery

- [ ] Run `yuncms init` against the bootstrapped test DB; verify first administrator creation and rerun behavior (no second silent initial admin).
- [ ] Verify valid login plus unknown-user/bad-password/inactive-user identical credential error behavior.
- [ ] Verify access/session expiry and disabled-user behavior.
- [ ] Verify refresh rotates both credentials; replay of the old refresh fails.
- [ ] Run two concurrent refreshes using the same refresh token and verify only one succeeds.
- [ ] Verify current-session logout and logout-all semantics.
- [ ] Change a password and confirm all sessions are revoked in the same transaction.
- [ ] Create/list/revoke API tokens; verify raw token/hash never appears in list responses and disabled owner disables authentication.
- [ ] Verify password reset token replacement, one-time consumption, sibling-token removal, session revocation and replay/expiry/wrong-prefix failure.
- [ ] Verify email verification is self/admin/system-only, consumes once and sets `email_verified_at`.

### SMTP/recovery delivery

Use a disposable/test mailbox/SMTP service.

- [ ] Configure `SMTP_HOST`, `SMTP_FROM` and credentials if required; verify reset mail arrives.
- [ ] Confirm reset-request HTTP response is indistinguishable for active vs nonexistent email addresses.
- [ ] Confirm raw reset/verification tokens never appear in the public request response or structured logs.
- [ ] Follow the Studio reset mail link, set a new password and confirm URL token parameters are removed afterward.
- [ ] Send verification from Studio Users, follow the link and verify the account.
- [ ] Simulate SMTP delivery failure and confirm unrelated API startup/traffic remains available and the failure is logged safely.

### Rate limits

- [ ] Exceed login/refresh/action limits and verify HTTP 429, `Retry-After` and rate-limit headers.
- [ ] Confirm new window restores access.
- [ ] For any multi-instance deployment, explicitly decide whether process-local limits are sufficient; if not, add a shared limiter before relying on cluster-wide protection.

## 6. Roles / permissions / validation

- [ ] Create a normal role and separate create/read/update/delete permission rows.
- [ ] Verify each missing action permission denies independently.
- [ ] Verify read field allowlists prevent selection, filtering and sorting through hidden fields.
- [ ] Verify server-side row filters restrict read/update/delete, including single-item-by-id operations.
- [ ] Verify write field allowlists reject extra create/update keys.
- [ ] Store a create/update `validation` rule and verify prospective records that fail it are rejected before mutation.
- [ ] Verify update validation uses current-row + patch final state rather than patch alone.
- [ ] Verify bulk update validation checks every affected prospective row and fails closed above the configured source-level safety cap.
- [ ] Verify request-local permission cache prevents duplicate resolution within one request but does not leak/stale across requests/processes.
- [ ] Verify permission mutation invalidates the current request cache.
- [ ] Verify explicit admin/system bypass, role-less public fail-closed and malformed/stale permission metadata fail-safe behavior.
- [ ] Verify protected administrator/public role rules and current-admin self-protection.

## 7. Management REST + Studio smoke

Run the actual built Studio against the disposable API/DB.

- [ ] Login and verify automatic access-token refresh/retry then logout.
- [ ] Content: collection list, generic table, create/edit/delete primitive records, loading/error/empty states.
- [ ] Data Model: create/delete collection, add/delete fields, required toggle, M2O create/delete, M2M create/delete once UI control is present.
- [ ] Users: create, role/status changes, self-protection, delete, verification-mail action.
- [ ] Roles/Permissions: create/update/delete role and permissions, field/row rules, validation editor once UI control is present.
- [ ] Files: upload/list/download/edit/delete.
- [ ] Check narrow-screen responsive behavior.
- [ ] Perform a formal keyboard/focus/label/accessibility review; source semantics alone are not considered verification.

## 8. Files / local storage

- [ ] Verify `FILES_LOCAL_ROOT` permissions and persistence with the actual deployment user.
- [ ] Upload binary/Unicode filename files; confirm UUID physical keys are independent from user filenames.
- [ ] Verify authenticated download MIME, length and Content-Disposition behavior.
- [ ] Verify upload body larger than `FILES_MAX_UPLOAD_BYTES` returns 413.
- [ ] Attempt traversal/path-separator storage keys and confirm rejection before filesystem access.
- [ ] Force metadata insert failure after storage write and verify object cleanup.
- [ ] Force storage delete failure after metadata deletion and confirm `FILE_STORAGE_CLEANUP_FAILED` is surfaced/logged for reconciliation.

## 9. S3-compatible provider

Use the provider actually intended for production.

- [ ] Configure `S3_BUCKET`, region, endpoint/path-style/credentials as appropriate.
- [ ] Upload/list/download/delete through `?storage=s3` and confirm metadata/storage consistency.
- [ ] Verify credential-chain behavior if explicit keys are intentionally omitted.
- [ ] Test provider-specific behavior (MinIO/R2/AWS/etc.) rather than assuming every S3-compatible service is identical.
- [ ] Force S3 errors and verify no credentials/secrets are returned to clients or logs.

## 10. Audit / logging / security headers

- [ ] Verify item create/update/delete audit rows contain actor/action/collection/item/request id/timestamp.
- [ ] Verify file lifecycle and schema admin mutations are audited.
- [ ] Verify schema/file update events retain before/after metadata where implemented.
- [ ] Put password/token/secret/authorization/api-key-shaped keys in audited/logged metadata and confirm recursive `[REDACTED]` output.
- [ ] Force audit write failure after a committed mutation and confirm the client still receives the committed mutation result while the audit failure is logged.
- [ ] Verify `/audit` is admin/system-only and pagination/filter basics work.
- [ ] Confirm runtime output is valid line-delimited JSON at configured log levels.
- [ ] Confirm `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and configured-origin CORS behavior.
- [ ] Verify unexpected errors/DB messages/stacks/secrets are not leaked through HTTP responses.

## 11. Extensions

- [ ] Copy/install endpoint and hook examples into a disposable project's active extensions directory and confirm startup discovery.
- [ ] Confirm endpoint extension is mounted only under `/extensions/<id>` after authentication middleware.
- [ ] Instantiate ItemsService/FilesService from `context.services` + `context.serviceOptions(req)` and verify accountability/RBAC/storage behavior without self-HTTP/token forwarding.
- [ ] Confirm extension request services share the request-local permission cache.
- [ ] Verify `app.beforeStart` before listen and `app.afterStart` only after listen.
- [ ] Verify malformed manifest, root escape, unknown type, duplicate id, invalid default export and manifest/definition mismatch fail startup cleanly.
- [ ] Pack/install a sample extension as an npm tarball and verify dependency discovery matches local behavior.

## 12. Graceful shutdown / runtime behavior

- [ ] Start an active request and DB transaction, send SIGTERM/SIGINT and verify graceful shutdown/drain behavior before force timeout.
- [ ] Confirm DB pool closes once and startup failure also closes it.
- [ ] Verify extension startup failure prevents partially running API.
- [ ] Verify SMTP outage does not fail unrelated API startup.

## 13. npm/package release decisions

Do not publish from this environment.

- [ ] Decide final public package/scope names (`yuncms`, `@yunsoft/*`, `@yuncms/*`, etc.).
- [ ] Confirm npm organization/authentication/permissions.
- [ ] Remove/adjust `private` package flags only when naming/release structure is final.
- [ ] Run `npm pack` for publishable packages and inspect included files.
- [ ] Install packed tarball(s) in a brand-new directory.
- [ ] From the packed install verify `npx yuncms init`, `bootstrap` and `start` as a real consumer would use them.
- [ ] Only publish after the above release gate passes.
