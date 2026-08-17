# YunCMS Development Plan

> Live status document for branch `16-08-2026`. Check an item only when source implementation exists. Runtime/install/real-MySQL/provider verification belongs in `todo.md`; source presence is not the same thing as a verified release.

## 0. Fixed product constraints

- [x] Independent Directus-inspired implementation; not a fork.
- [x] Node.js 24 LTS baseline.
- [x] JavaScript/ESM; no TypeScript by default.
- [x] Express 5 HTTP layer.
- [x] MySQL only.
- [x] `mysql2/promise` directly; no ORM/query-builder/second DB driver.
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
- [x] Package naming finalized under the verified `@yunsoft/*` npm organization; the executable remains `yuncms`.
- [x] Generate/review `package-lock.json` after real `npm install` — `todo.md`.
- [x] Verify final npm scope/name ownership, auth, tarballs and fresh install — `todo.md`.

## 2. Core request/service architecture

- [x] Explicit public/system/admin accountability helpers.
- [x] Frozen request context with accountability/services/database/schema/logger/env/emitter/storage/request id.
- [x] Request-local permission cache in context.
- [x] Base service contract.
- [x] Core service registry.
- [x] Same service/accountability model exposed to trusted extension runtime.
- [x] Dedicated auth/user/session/token/file/audit/maintenance services own special behavior.

## 3. MySQL/bootstrap foundation

- [x] Single `mysql2/promise` pool factory.
- [x] DB ping/close helpers.
- [x] Pinned-connection transaction helpers.
- [x] Identifier validation/quoting.
- [x] Multi-statements disabled.
- [x] Placeholder-bound data values throughout current services.
- [x] MySQL duplicate/FK/deadlock/lock/connection normalization.
- [x] Bounded retry helper for retryable lock/deadlock classes.
- [x] Migration journal.
- [x] Versioned core migrations (`0001`–`0004`).
- [x] Bootstrap advisory lock.
- [x] Schema advisory lock.
- [x] Schema version state/read/increment.
- [x] API startup compatibility guard; API does not auto-bootstrap.
- [x] Real-MySQL bootstrap/transaction/concurrency verification — `todo.md`.

## 4. Dynamic schema engine

### Collections

- [x] List/read/create collection.
- [x] `id CHAR(36)` primary key + matching field metadata.
- [x] Reserved `yuncms_` prefix protection.
- [x] Safe metadata update.
- [x] Explicit destructive delete.
- [x] Tombstone rename + metadata compensation.

### Fields

- [x] integer / bigint.
- [x] decimal.
- [x] string / text.
- [x] boolean.
- [x] date / datetime / timestamp.
- [x] json.
- [x] uuid (`CHAR(36)`).
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
- [x] High-level destructive M2M junction delete lifecycle with tombstone restore/cleanup behavior.
- [x] M2M delete REST surface with schema audit.
- [x] One-level direct M2O expansion in generic item responses.
- [x] Expansion reuses target `ItemsService` RBAC and source field visibility checks.
- [x] Studio direct-M2O relation picker/display-label UX.
- [x] Studio M2M junction create/delete lifecycle controls.
- [x] O2M/M2M nested expansion intentionally remains outside V1.

### Schema consistency

- [x] Metadata repository.
- [x] Schema snapshot/cache keyed by schema version.
- [x] Metadata + schema-version transaction discipline after physical DDL.
- [x] Admin/system-only schema service access.
- [x] Explicit destructive intent guards.
- [x] Source-level invalid M2M/FK/schema combination guards.
- [x] Real-MySQL DDL compensation/concurrency/drift verification — `todo.md`.

## 5. Generic ItemsService + REST

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
- [x] `expand` for direct M2O reads, max-eight guard.
- [x] `readMany/readOne`.
- [x] `createOne/createMany`.
- [x] Single/bulk update.
- [x] Single/bulk delete.
- [x] Bulk update/delete require explicit non-empty caller filter.
- [x] Mutation filter/action hook integration.
- [x] Bulk create actions only after transaction commit.
- [x] Request id/accountability propagated to hook context.
- [x] Relation expansion preserves target permission row/field restrictions.
- [x] Real-MySQL/API SQL-injection/rollback/relation-expansion verification — `todo.md`.

## 6. Authentication and sessions

- [x] Users repository/service.
- [x] Scrypt password hashing/verification.
- [x] Email/password login.
- [x] Access + refresh session creation.
- [x] Refresh rotation/replay-safe update condition.
- [x] Logout current/all sessions.
- [x] Password-change session revocation.
- [x] Bearer authentication middleware.
- [x] Explicit public-role resolution.
- [x] API token create/list/revoke/authentication.
- [x] Password-reset one-time hashed-token lifecycle.
- [x] Email-verification one-time hashed-token lifecycle.
- [x] SMTP transport using Nodemailer with file/URL message access disabled.
- [x] Non-enumerating public reset request endpoint.
- [x] Reset confirmation endpoint.
- [x] Authenticated verification-mail request endpoint.
- [x] Verification confirmation endpoint.
- [x] Raw reset/verification tokens are not returned by public request endpoints.
- [x] Configurable process-local login/refresh/action rate limiting.
- [x] Auth responses explicitly use `Cache-Control: no-store`.
- [x] Shared-store/cluster-wide limiter intentionally remains a multi-instance follow-up, not a single-process V1 requirement.
- [x] Real MySQL/SMTP/replay/rate-limit verification — `todo.md`.

## 7. Roles and permissions

- [x] Administrator/system-managed role CRUD.
- [x] Protected admin/public role rules.
- [x] Permission CRUD.
- [x] Exact role + collection + action resolution.
- [x] Field allowlists.
- [x] Server-side row filters.
- [x] Hidden-field filter/sort/expand inference protection.
- [x] Fail-closed role-less/missing-permission behavior.
- [x] Explicit admin/system bypass.
- [x] Request-local effective-permission cache.
- [x] Permission mutation clears current request cache.
- [x] Create/update prospective-record validation.
- [x] Validation uses safe field/operator allowlist.
- [x] Bulk update validation fail-closed row limit.
- [x] Studio permission filter + validation editor.
- [x] Real privilege-escalation/validation integration tests — `todo.md`.

## 8. Extension system

- [x] `@yunsoft/yuncms-extensions-sdk`.
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
- [x] Local/npm-packed extension runtime smoke — `todo.md`.

## 9. Files and storage

- [x] Storage registry/core driver contract.
- [x] Local filesystem driver.
- [x] Platform-aware traversal/path containment checks.
- [x] S3-compatible driver using AWS SDK v3.
- [x] Custom endpoint/path-style/credential-chain configuration.
- [x] Built-in local/S3 inventory listing capability.
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
- [x] Admin/system storage reconciliation service + REST endpoint.
- [x] Reconciliation defaults to dry-run and reports missing/orphan objects.
- [x] Destructive orphan cleanup requires explicit request + object-age guard.
- [x] Reconciliation has a bounded V1 inventory safety limit.
- [ ] Real local filesystem/S3-provider/reconciliation verification — `todo.md`.

## 10. Audit/history

- [x] `AuditService` write/read surface.
- [x] Actor/action/collection/item/request id/timestamp.
- [x] Recursive password/token/secret/authorization/api-key redaction.
- [x] Item create/update/delete audit through internal hook subscriber.
- [x] File create/update/delete audit through service events.
- [x] Schema admin create/update/delete audit.
- [x] Before/after metadata captured where practical.
- [x] Admin `/audit` read API.
- [x] Audit write failure after committed mutation is logged rather than faking a client rollback.
- [x] Configurable retention defaults.
- [x] Explicit bounded batch cleanup service/API; no surprise automatic purge.
- [ ] Real cleanup/retention/load verification — `todo.md`.

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
- [x] Initial admin creation/reuse wired into `init`.
- [x] Environment-driven non-interactive `bootstrap`.
- [x] `start` wrapper resolving API server package entry and preserving caller cwd/env.
- [x] Publishing/naming policy documented.
- [x] Final npm ownership/auth/`npm pack`/fresh-install verification — `todo.md`.

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
- [x] Direct M2O relation pickers/display labels.
- [x] Data Model collection/field workflows.
- [x] M2O/M2M creation UI.
- [x] M2M delete UI.
- [x] Users management UI.
- [x] Email-verification send action.
- [x] Roles/Permissions management UI.
- [x] Permission validation JSON editor.
- [x] Files management UI.
- [x] Loading/error/empty-state basics.
- [x] Task-oriented sidebar groups: Content / Library / Settings.
- [x] Non-system collections rendered directly as nested Content navigation instead of selecting a collection from a toolbar dropdown.
- [x] Content workspace keeps collection context stable across list/create/edit states.
- [x] Content search is server-backed across readable text fields rather than limited to the current page.
- [x] Content supports field-aware filters, removable filter chips and one-click view reset.
- [x] Content sorting uses REST `sort` semantics and supports clickable table headers plus explicit direction controls.
- [x] Content pagination uses REST `limit`, `offset` and filtered `total_count`, with selectable page sizes.
- [x] Studio data-heavy workspaces share one reusable numbered `Pagination` component with total/range, page-size and compact modes.
- [x] Files defaults to a gallery with authenticated image previews, file placeholders, search and grid/list switching.
- [x] Files previews load only for the visible page, fall back from MIME metadata to safe image extensions and degrade cleanly on fetch/decode failure.
- [x] Files includes type filters, useful sort presets, client-side pagination and state-preserving Gallery/List switching.
- [x] File metadata editing moved from `window.prompt()` into an in-page editor.
- [x] Users is list-first with creation behind `New user`, plus search, role/status filters, sort controls, pagination and readable status/verification badges.
- [x] Data Model uses a collection master/detail settings layout with focused `New collection` flow and Fields/Relations tabs.
- [x] Data Model collection and field lists support search, sorting, shared pagination and clearer type/required/read-only hierarchy.
- [x] Data Model `Add field` form stays collapsed until explicitly requested.
- [x] Roles/Permissions uses a role-first collection/action matrix with direct simple toggles.
- [x] Roles support search/sort/pagination; permission collections support search, configured-only auditing and shared pagination.
- [x] Advanced field allowlist/filter/validation permission editing uses the existing focused modal layer and validates JSON before save.
- [x] Permission matrix keeps the collection column/header scannable while preserving current RBAC API behavior and administrator/public protections.
- [x] Important file/role/permission edits no longer depend on prompt-only workflows.
- [x] Shared list-control patterns expose result counts/reset actions and stack on narrow screens without a new dependency.
- [x] Refreshed workspaces have narrow-screen responsive rules without a new UI dependency.
- [x] Studio API URL defaults to browser same-origin; `VITE_API_URL` remains an explicit override.
- [x] Vite build output targets the API package runtime bundle directory.
- [x] Relation picker V1 intentionally caps target list at 200; paginated/search picker is scale polish rather than a V1 correctness blocker.
- [ ] Formal accessibility/keyboard review — `todo.md`.
- [ ] Refreshed Studio browser/build/runtime smoke — `todo.md`.

## 13. API/runtime/observability

- [x] Express runtime.
- [x] Request ids.
- [x] `/health`.
- [x] `/ready`.
- [x] Graceful HTTP + MySQL shutdown path.
- [x] Narrow configured Studio CORS origin.
- [x] Baseline security headers (`nosniff`, frame deny, no-referrer, restrictive permissions policy, same-origin resource policy).
- [x] HSTS intentionally left to the TLS/reverse-proxy deployment layer.
- [x] Read-only migration compatibility check before listen.
- [x] Canonical error body/status mapping.
- [x] Raw unexpected internal messages hidden from clients.
- [x] Known MySQL errors normalized to stable safe API errors.
- [x] Structured line-delimited JSON logger wired into runtime.
- [x] Runtime logger secret redaction.
- [x] Auth rate-limit headers/HTTP 429.
- [x] Built Studio index and hashed assets served from the same Express listener with Node filesystem streams.
- [x] Studio static handler is restricted to `/` and `/assets/...`; unrelated requests continue through normal API routing.
- [x] Root `npm start` builds Studio before starting the single API/Studio listener.
- [x] Default Studio/auth public URLs align with the API port.
- [x] API package file list includes the generated Studio bundle for packed and public-registry installs.
- [x] API/runtime/security-header/graceful-shutdown smoke — `todo.md`.
- [ ] Single-port built Studio HTML/assets/API browser smoke — `todo.md`.

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
- [x] `docs/studio-ui-improvement-plan.md` live UI improvement checklist.
- [x] `docs/studio-usability-pass.md` focused shared-pagination/media/settings usability checklist.
- [x] `docs/files.md`.
- [x] `docs/security.md`.
- [x] `docs/deployment.md`.
- [x] `docs/publishing.md` naming/release policy.
- [x] Convert publishing policy into final npm install guide after real npm ownership/pack verification — `todo.md`.

## 15. Source-level regression coverage present

- [x] DB config/identifier/error/retry.
- [x] Bootstrap/advisory-lock.
- [x] Schema/query/ItemsService.
- [x] Schema service authorization/destructive/M2M preflight/lifecycle.
- [x] Direct relation expansion + source permission guard.
- [x] Auth/session/API-token/action-token.
- [x] RBAC/permission cache/validation evaluator.
- [x] Hook recursion/item hooks.
- [x] Extension manifest/discovery/runtime context.
- [x] API error-contract/MySQL normalization.
- [x] Security/auth cache-header middleware.
- [x] CLI start dispatch.
- [x] Local storage/FilesService security/cleanup.
- [x] S3 driver contract.
- [x] Guarded storage reconciliation.
- [x] Audit redaction + bounded cleanup.
- [x] Single-port Studio default config and static asset path/traversal resolution.
- [x] Execute tests after dependency install — `todo.md`.

## 16. Verification milestones

The major V1 feature source implementations now exist. These milestone boxes stay open until the corresponding runtime checks are actually executed.

- [x] Milestone A — dependency install/lockfile + Node 24 + tests + API/Studio build/start verified.
- [x] Milestone B — real MySQL bootstrap/schema/CRUD/query/relation lifecycle and rollback behavior verified.
- [x] Milestone C — real auth/SMTP/replay/RBAC/validation/rate-limit behavior verified.
- [ ] Milestone D — extension local/npm runtime + refreshed Studio end-to-end and single-port smoke verified.
- [ ] Milestone E — local/S3 files, reconciliation, audit cleanup, logging/security headers and graceful shutdown verified.
- [x] Release — npm naming ownership, tarballs, fresh install and `yuncms init/bootstrap/start` verified.

## 17. Remaining source work excluding manual verification

There is no known blocking V1 source feature left in the current roadmap after the Studio usability, sortable/filterable data-control and single-port source passes.

Future/non-blocking follow-ups are deliberately outside the V1 release gate unless product requirements change:

- cluster-wide/shared-store rate limiting for multi-instance deployments;
- O2M/M2M nested item expansion;
- paginated/search relation picker beyond the current 200-item Studio picker;
- M2M multi-select content editor on top of explicit junction records;
- session-management UI, MFA and SSO families;
- extension sandbox/marketplace isolation;
- automatic scheduled maintenance/retention jobs if operators later want them.