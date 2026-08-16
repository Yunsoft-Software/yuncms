# YunCMS Development Plan

> Live status document for branch `16-08-2026`. Check an item only when source implementation exists. Runtime/install/real-MySQL/provider verification belongs in `todo.md` and does **not** get converted into a source-complete checkbox here.

## 0. Fixed product constraints

- [x] Independent implementation inspired by the Directus features we actually use; not a fork.
- [x] Node.js 24 LTS baseline.
- [x] JavaScript/ESM; no TypeScript by default.
- [x] Express 5 HTTP layer.
- [x] MySQL only.
- [x] `mysql2/promise` directly; no ORM/query-builder/second database driver.
- [x] React 19.2 + Vite 8 Studio.
- [x] npm workspaces.
- [x] REST only; no GraphQL.
- [x] Directus-like extension ergonomics where useful (`defineEndpoint`, `defineHook`).
- [x] Internal services/extensions never self-request YunCMS over HTTP.
- [x] No GitHub Actions.
- [x] Small focused commits.
- [x] Documentation changes travel with implementation.

### Explicit V1 non-goals

- [x] No GraphQL.
- [x] No visual Flow/dashboard builder.
- [x] No Vue.
- [x] No multi-database abstraction.
- [x] No AI/MCP in core.
- [x] No SSO/SAML/LDAP/MFA in V1.
- [x] No untrusted extension marketplace sandbox in V1.
- [x] No full Directus-style visual ER diagram editor in V1.
- [x] No content versioning/translations/presets/bookmarks in V1.

## 1. Repository/toolchain

- [x] npm workspace skeleton (`apps/*`, `packages/*`).
- [x] Root scripts/environment/editor/git baseline.
- [x] `AGENTS.md` working rules.
- [x] `todo.md` manual/environment handoff rules.
- [x] Node/toolchain engines pinned in package metadata.
- [ ] Generate/review `package-lock.json` after real `npm install` — **environment task in `todo.md`**.
- [ ] Finalize public npm package/scope names before release — **release decision**.

## 2. Core request/service architecture

- [x] Explicit public/system/admin accountability helpers.
- [x] Frozen request context with accountability/services/database/schema/logger/env/emitter/storage/request id.
- [x] Request-local permission cache in context.
- [x] Base service contract.
- [x] Core service registry.
- [x] Same registry/service options available to trusted extension runtime.
- [x] Dedicated auth/user/session/token/file/audit services own special behavior.

## 3. MySQL/bootstrap foundation

- [x] Single `mysql2/promise` pool factory.
- [x] DB ping/close helpers.
- [x] Pinned-connection transaction helpers.
- [x] Identifier validation/quoting.
- [x] Multi-statements disabled.
- [x] Placeholder-bound data values throughout current services.
- [x] MySQL duplicate/FK/deadlock/lock/connection normalization.
- [x] Bounded retry helper for retryable DB lock/deadlock classes.
- [x] Migration journal.
- [x] Versioned core migrations (`0001`–`0004`).
- [x] Bootstrap advisory lock.
- [x] Schema advisory lock.
- [x] Schema version state/read/increment.
- [x] API startup compatibility guard; API does not auto-bootstrap.
- [ ] Real-MySQL bootstrap/transaction/concurrency verification — `todo.md`.

## 4. Dynamic schema engine

### Collections

- [x] List/read/create collection.
- [x] `id CHAR(36)` primary key + matching field metadata.
- [x] Reserved `yuncms_` prefix protection.
- [x] Safe metadata update.
- [x] Explicit destructive delete.
- [x] Tombstone rename + metadata compensation strategy.

### Fields

Supported physical families:

- [x] integer / bigint.
- [x] decimal.
- [x] string / text.
- [x] boolean.
- [x] date / datetime / timestamp.
- [x] json.
- [x] uuid (`CHAR(36)`).

Operations:

- [x] Create/read field.
- [x] Metadata-only update.
- [x] Validated required/null mutation.
- [x] Supported default add/change/remove.
- [x] Engine-managed index add/remove.
- [x] Explicit destructive delete with tombstone compensation.
- [x] Type conversion intentionally disabled in V1.

### Relations

- [x] M2O physical FK create with type/target/on-delete validation.
- [x] M2O delete with FK restoration compensation.
- [x] O2M inverse metadata read.
- [x] M2M junction create with two FKs + unique pair + paired metadata.
- [x] High-level destructive M2M junction delete lifecycle helper.
- [x] M2M delete REST surface with schema audit.
- [ ] Direct relation expansion in generic item responses — **V1 polish; keep behind real-MySQL CRUD verification**.
- [ ] Full Studio relation picker/display-label UX — **V1 polish**.

### Schema consistency

- [x] Metadata repository.
- [x] Schema snapshot/cache keyed by schema version.
- [x] Metadata + schema-version transaction discipline after physical DDL.
- [x] Admin/system-only schema service access.
- [x] Explicit destructive intent guards.
- [x] Source-level invalid M2M/FK/schema combination guards.
- [ ] Real-MySQL DDL compensation/concurrency/drift tests — `todo.md`.

## 5. Generic ItemsService + REST

REST:

```text
GET    /items/:collection
GET    /items/:collection/:id
POST   /items/:collection
PATCH  /items/:collection/:id
DELETE /items/:collection/:id
```

- [x] Schema-aware collection/field validation.
- [x] Query parser.
- [x] Allowlisted SQL filter compiler.
- [x] `fields`, `filter`, `sort`, `limit`, `offset`, count metadata.
- [x] `readMany/readOne`.
- [x] `createOne/createMany`.
- [x] single/bulk update.
- [x] single/bulk delete.
- [x] Bulk update/delete require explicit non-empty caller filter.
- [x] Mutation filter/action hook integration.
- [x] Bulk create actions only after transaction commit.
- [x] Request id/accountability propagated to hook context.
- [ ] Relation expansion — tracked in section 4.
- [ ] Real-MySQL/API SQL-injection/rollback verification — `todo.md`.

## 6. Authentication and sessions

- [x] Users repository/service.
- [x] Scrypt password hashing/verification.
- [x] Email/password login.
- [x] Access + refresh session creation.
- [x] Refresh rotation/replay-safe update condition.
- [x] Logout current/all sessions.
- [x] Password-change session revocation policy.
- [x] Bearer authentication middleware.
- [x] Explicit public-role resolution.
- [x] API token create/list/revoke/authentication.
- [x] Password-reset one-time hashed-token lifecycle.
- [x] Email-verification one-time hashed-token lifecycle.
- [x] SMTP transport using Nodemailer with file/URL message access disabled.
- [x] Public reset request endpoint with non-enumerating accepted response.
- [x] Reset confirmation endpoint.
- [x] Authenticated verification-mail request endpoint.
- [x] Verification confirmation endpoint.
- [x] Raw reset/verification tokens are not returned by public request endpoints.
- [x] Configurable process-local login/refresh/action rate limiting.
- [ ] Shared-store/cluster-wide rate limiter — **multi-instance follow-up, not required for single-process V1**.
- [ ] Real MySQL/SMTP/replay/rate-limit verification — `todo.md`.

## 7. Roles and permissions

- [x] Administrator/system-managed role CRUD foundation.
- [x] Protected admin/public role rules.
- [x] Permission CRUD.
- [x] Exact role + collection + action resolution.
- [x] Field allowlists.
- [x] Server-side row filters.
- [x] Hidden-field filter/sort inference protection.
- [x] Fail-closed role-less/missing-permission behavior.
- [x] Explicit admin/system bypass.
- [x] Request-local effective-permission cache.
- [x] Permission mutation clears the current request cache.
- [x] Create/update prospective-record validation rules.
- [x] Validation uses the same safe field/operator schema allowlist.
- [x] Bulk update validation fail-closed limit.
- [ ] Real privilege-escalation/validation integration tests — `todo.md`.

## 8. Extension system

- [x] `@yuncms/extensions-sdk`.
- [x] `defineEndpoint`.
- [x] `defineHook`.
- [x] Local extension discovery.
- [x] npm dependency extension discovery.
- [x] Manifest validation/root-escape/duplicate-id/type checks.
- [x] SDK/runtime marker contract aligned.
- [x] Endpoint mount under `/extensions/<id>` after authentication.
- [x] `filter` / `action` / `init` emitter.
- [x] AsyncLocalStorage recursion-chain protection.
- [x] `app.beforeStart` / `app.afterStart` lifecycle.
- [x] Extension context exposes services/database/schema/accountability/logger/env/emitter/storage.
- [x] Request service options preserve permission cache/accountability.
- [x] Endpoint/hook examples.
- [x] Extension authoring docs.
- [ ] Local/npm-packed extension runtime smoke — `todo.md`.

## 9. Files and storage

- [x] Storage registry/driver contract.
- [x] Local filesystem driver.
- [x] Platform-aware traversal/path containment checks.
- [x] S3-compatible driver using AWS SDK v3.
- [x] Custom endpoint/path-style/credential-chain configuration.
- [x] `FilesService` metadata/storage coordination.
- [x] UUID physical storage keys independent from download filename.
- [x] Upload cleanup when metadata insert fails.
- [x] Explicit cleanup error when storage delete fails.
- [x] File list/read/content/update/delete.
- [x] Upload/download/delete REST routes.
- [x] Upload byte limit + HTTP 413 mapping.
- [x] Unicode-safe download filename handling.
- [x] `files.create/update/delete` hook/audit events.
- [x] Studio file list/upload/download/edit/delete.
- [ ] Full storage inventory/orphan reconciliation command — **follow-up; cleanup failures are surfaced today**.
- [ ] Real local filesystem/S3-provider verification — `todo.md`.

## 10. Audit/history

- [x] `AuditService` write/read surface.
- [x] Actor/action/collection/item/request id/timestamp.
- [x] Recursive password/token/secret/authorization/api-key redaction.
- [x] Item create/update/delete audit through internal hook subscriber.
- [x] File create/update/delete audit through service events.
- [x] Schema admin create/update/delete audit.
- [x] Before/after metadata captured for schema/file updates where practical.
- [x] Admin `/audit` read API with pagination/filter basics.
- [x] Audit write failure after committed mutation is logged rather than converting the committed operation into a false client rollback.
- [ ] Configurable audit retention/cleanup — **post-V1 operational policy**.

## 11. CLI/setup

```text
yuncms init
yuncms bootstrap
yuncms start
yuncms help
```

- [x] CLI package + bin dispatcher.
- [x] Node 24 runtime guard.
- [x] Interactive `init` DB prompts.
- [x] Secret-safe prompt path.
- [x] `.env` writer/reuse behavior.
- [x] DB connection verification.
- [x] Bootstrap command.
- [x] Initial admin creation/reuse behavior wired into `init`.
- [x] Environment-driven non-interactive `bootstrap` for servers/containers.
- [x] `start` command wrapper resolving the API server package entry.
- [ ] Final public npm naming/auth/`npm pack`/fresh-install verification — `todo.md`.

## 12. React Studio V1

- [x] React/Vite shell/sidebar.
- [x] API health status.
- [x] Real API client.
- [x] Session storage + serialized refresh + retry.
- [x] Login/logout.
- [x] Password-reset request mode.
- [x] Reset action-link/new-password screen.
- [x] Email-verification action-link screen.
- [x] Generic collection table.
- [x] Generic create/edit record form.
- [x] Data Model collection/field workflows.
- [x] M2O/M2M creation UI.
- [x] Users management UI.
- [x] Email-verification send action in Users UI.
- [x] Roles/Permissions management UI.
- [x] Files management UI.
- [x] Loading/error/empty-state basics.
- [ ] Dedicated permission-validation JSON editor in Studio — **backend support exists; UX polish**.
- [ ] M2M delete button in Studio — **backend/API support exists; UX polish**.
- [ ] Relation picker/display labels in generic record form — **UX polish**.
- [ ] Formal accessibility/keyboard review — `todo.md`/manual verification.
- [ ] Studio build/runtime smoke — `todo.md`.

## 13. API/runtime/observability

- [x] Express runtime.
- [x] Request ids.
- [x] `/health`.
- [x] `/ready`.
- [x] Graceful HTTP + MySQL shutdown path.
- [x] Narrow configured Studio CORS origin.
- [x] Basic security headers.
- [x] Read-only migration compatibility check before listen.
- [x] Canonical error body/status mapping.
- [x] Raw unexpected internal messages hidden from clients.
- [x] Raw known MySQL errors normalized to stable safe API errors.
- [x] Structured line-delimited JSON logger.
- [x] Runtime logger secret redaction.
- [x] Auth rate-limit headers/HTTP 429.
- [ ] API/runtime smoke and graceful-shutdown verification — `todo.md`.

## 14. Documentation

- [x] `README.md` project overview.
- [x] `docs/architecture.md`.
- [x] `docs/development.md`.
- [x] `docs/database.md`.
- [x] `docs/rest-api.md`.
- [x] `docs/auth.md`.
- [x] `docs/permissions.md`.
- [x] `docs/extensions.md`.
- [x] `docs/setup-cli.md`.
- [x] `docs/studio.md`.
- [x] `docs/files.md`.
- [x] `docs/security.md`.
- [x] `docs/deployment.md`.
- [ ] Final release/npm installation guide after package names are fixed.

## 15. Source-level regression coverage present

- [x] DB config/identifier/error/retry sources.
- [x] bootstrap/advisory-lock sources.
- [x] schema/query/ItemsService sources.
- [x] schema service authorization/destructive/M2M preflight sources.
- [x] auth/session/API-token/action-token sources.
- [x] RBAC/permission cache/validation evaluator sources.
- [x] hook recursion/item hook sources.
- [x] extension manifest/discovery/runtime-context sources.
- [x] API error-contract/MySQL normalization sources.
- [x] CLI start dispatch source.
- [x] local storage/FilesService security/cleanup sources.
- [x] S3 driver contract sources.
- [ ] Run these tests after dependency install — `todo.md`.

## 16. Milestones

### Milestone A — runnable skeleton
Source implementation exists. Completion requires dependency install, Node 24 runtime, API/Studio start/build and non-MySQL test execution.

- [ ] Milestone A verified — blocked only on `todo.md` execution.

### Milestone B — schema + CRUD
Source implementation exists for bootstrap/schema/CRUD/query/RBAC/schema lifecycle. Completion requires real-MySQL integration and API smoke.

- [ ] Milestone B verified — blocked only on `todo.md` execution.

### Milestone C — auth + RBAC
Source implementation exists for login/session/API tokens/recovery/verification/rate limits/field-row-validation permissions.

- [ ] Milestone C verified — blocked on real MySQL/SMTP/auth/replay/privilege checks in `todo.md`.

### Milestone D — extensions + useful Studio
Source implementation exists for extension runtime and the main Studio workflows. Remaining relation/M2M/validation editor items are UX polish rather than blockers for the generic V1 workflow.

- [ ] Milestone D verified — blocked on install/build/runtime/extension/Studio smoke in `todo.md`.

### Milestone E — production-useful V1
Files local+S3, audit, recovery mail, logging/security headers and CLI lifecycle now have source implementations.

- [ ] Milestone E verified — production claim remains blocked on the full `todo.md` release gate and npm packaging decisions.

## 17. Remaining source work (excluding tests/manual verification)

These are the actual feature/code items left after the current branch work:

- [ ] Generic ItemsService relation expansion.
- [ ] Studio relation picker/display-label UX.
- [ ] Studio M2M delete control.
- [ ] Studio permission-validation editor.
- [ ] Full storage inventory/orphan reconciliation command.
- [ ] Optional configurable audit-retention command/policy.
- [ ] Final npm package naming/public release wiring after owner decision.

Everything else that is still unchecked above is an environment/provider/runtime verification task and belongs in `todo.md`.
