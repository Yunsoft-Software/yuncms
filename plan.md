# YunCMS Development Plan

> Live status document. Every completed implementation item must be checked here when the implementation lands. `AGENTS.md` defines the working rules; `todo.md` is only for environment/manual blockers.

## 0. Product definition

YunCMS is a small reusable backend platform inspired by the Directus features we actually use: schema-aware CRUD, auth/RBAC, files, server extensions, a setup CLI and a minimal Studio. It is an independent implementation, not a Directus fork.

### Fixed constraints
- [x] Repository: `Uncw3b-Software/yuncms`.
- [x] Node.js 24 LTS baseline.
- [x] JavaScript/ESM; no TypeScript by default.
- [x] Express 5 HTTP layer.
- [x] MySQL only for V1.
- [x] `mysql2/promise` directly; no ORM/Knex/Prisma/Sequelize/second driver.
- [x] React 19.2 Studio with Vite 8.
- [x] npm workspaces.
- [x] REST only; no GraphQL.
- [x] Directus-like extension ergonomics where useful, without compatibility complexity for its own sake.
- [x] No GitHub Actions unless the owner explicitly changes this rule.
- [x] Small focused commits.
- [x] Documentation updated while implementation progresses.

### Explicit V1 non-goals
- [x] No GraphQL.
- [x] No visual Flow builder.
- [x] No dashboard/Insights builder.
- [x] No Vue.
- [x] No multi-database abstraction.
- [x] No AI/MCP in core.
- [x] No SSO/SAML/LDAP in the first milestone.
- [x] No extension marketplace/untrusted extension sandbox in the first milestone.
- [x] No visual ER editor in the first Studio milestone.
- [x] No content versioning/translations/presets/bookmarks in the first milestone.

## 1. Repository/toolchain foundation

Target shape:

```text
yuncms/
├── apps/
│   └── studio/
├── packages/
│   ├── api/
│   ├── core/
│   ├── extensions-sdk/
│   └── cli/
├── docs/
├── examples/
├── AGENTS.md
├── plan.md
└── todo.md
```

- [x] Create npm workspace skeleton.
- [x] Add shared root scripts without a build orchestrator.
- [x] Add `.gitignore`, `.editorconfig`, `.env.example`.
- [x] Pin current runtime/toolchain policy in package metadata.
- [ ] Generate and inspect `package-lock.json` after local `npm install`.
- [ ] Add package READMEs only when each package has a real public contract.

## 2. Core architecture

### 2.1 Request context / accountability
Target request/extension context:

```js
{
  accountability: {
    user: 'uuid-or-null',
    role: 'uuid-or-null',
    admin: false,
    public: false
  },
  services,
  database,
  schema,
  logger,
  env,
  emitter
}
```

Rules:
- public/system/admin access is explicit;
- `null` never silently means administrator;
- HTTP routes call services;
- internal code/extensions do not self-request YunCMS over HTTP;
- authorization is enforced in services so HTTP and extensions share behavior.

Tasks:
- [x] Implement request context factory.
- [x] Implement explicit public/system accountability helpers.
- [x] Add context propagation/accountability test sources.

### 2.2 Service layer
Target service names:
- `ItemsService`
- `CollectionsService`
- `FieldsService`
- `RelationsService`
- `UsersService`
- `RolesService`
- `PermissionsService`
- `FilesService`

- [x] Define base service contract.
- [x] Implement service registry and expose current core services to API request context.
- [x] Expose the same service registry through the trusted extension runtime.
- [x] Ensure dedicated system services own special behavior such as password hashing/session invalidation.

### 2.3 MySQL foundation
- [x] Create one `mysql2/promise` pool factory.
- [x] Add DB health check and graceful pool shutdown.
- [x] Add pool transaction helper that pins a connection and guarantees rollback/release.
- [x] Add transaction helper for an already-pinned connection.
- [x] Add safe SQL identifier validation/quoting helper.
- [x] Disable multi-statements in pool configuration.
- [x] Add MySQL error normalization for duplicate/FK/deadlock/lock/connection classes.
- [x] Add bounded deadlock/lock-timeout retry helper.
- [x] Use placeholders for data values in current metadata/schema/query/item/RBAC/auth services; keep this invariant for future services.
- [ ] Add real-MySQL transaction/error integration tests.

## 3. System metadata and bootstrap

Initial reserved tables:
- `yuncms_collections`
- `yuncms_fields`
- `yuncms_relations`
- `yuncms_users`
- `yuncms_sessions`
- `yuncms_roles`
- `yuncms_permissions`
- `yuncms_api_tokens`
- `yuncms_auth_tokens`
- `yuncms_files`
- `yuncms_schema_migrations`
- `yuncms_schema_state`
- `yuncms_audit_log`

Invariants:
- physical MySQL schema and YunCMS metadata must not drift silently;
- schema mutation is serialized with a MySQL advisory lock;
- successful schema mutation increments schema version;
- startup checks required system migration version before serving application traffic;
- destructive schema operations require explicit intent.

Tasks:
- [x] Define bootstrap migration object/statement format.
- [x] Implement migration journal.
- [x] Implement bootstrap runner.
- [x] Implement schema advisory lock helper.
- [x] Implement schema version reader/increment helper.
- [x] Implement read-only startup compatibility checks before API listen.
- [x] Add versioned auth action-token migration for reset/verification lifecycle.
- [x] Add unit test sources for migration runner and advisory lock contracts.
- [ ] Add bootstrap idempotency tests against real MySQL.

## 4. Dynamic schema engine

### CollectionsService V1
- create/read/list collection;
- update safe metadata;
- delete only with explicit destructive flag;
- rename postponed until rename/data-loss semantics are proven.

### FieldsService V1
Initial physical types:
- integer / bigint
- decimal
- string / text
- boolean
- date / datetime / timestamp
- json
- uuid stored as `char(36)` initially

Operations:
- add field;
- update safe metadata;
- nullable/default/index changes through validated operations;
- delete only with explicit destructive flag;
- type conversions postponed until a conversion-safety policy exists.

### RelationsService V1
- M2O = physical FK field;
- O2M = inverse metadata for M2O;
- M2M = explicit junction collection;
- validate FK type compatibility;
- support `RESTRICT`, `CASCADE`, `SET NULL` only when structurally valid.

Tasks:
- [x] Build schema metadata repository for collections/fields/relations.
- [x] Build collections create/read/list path with physical table + metadata compensation on failure.
- [x] Build collection metadata-only safe update path.
- [ ] Build collection explicit destructive delete path.
- [x] Build primitive field type compiler and fields create/read path.
- [x] Build field metadata-only safe update path.
- [ ] Build physical nullable/default/index mutation policy and implementation.
- [ ] Build field explicit destructive delete path.
- [x] Build M2O creation with FK/type/on-delete validation and cleanup compensation.
- [x] Build M2O delete path with FK restore compensation on metadata failure.
- [x] Build O2M inverse representation/read API.
- [ ] Build M2M junction helper.
- [x] Add schema cache keyed by schema version.
- [x] Make metadata + schema-version changes atomic and let version changes invalidate cached snapshots only after commit.
- [ ] Add concurrent DDL tests against real MySQL.
- [ ] Add partial-failure recovery tests against real MySQL.

## 5. Generic ItemsService + REST query language

REST target:

```text
GET    /items/:collection
GET    /items/:collection/:id
POST   /items/:collection
PATCH  /items/:collection/:id
DELETE /items/:collection/:id
```

Query V1:
- `fields`
- `filter`
- `sort`
- `limit`
- `offset`
- basic count metadata

Filter allowlist:
- `_eq`, `_neq`
- `_lt`, `_lte`, `_gt`, `_gte`
- `_in`, `_nin`
- `_null`, `_nnull`
- `_contains`, `_starts_with`, `_ends_with`
- `_and`, `_or`

Security rules:
- URL/query collection and field names resolve through trusted schema metadata;
- values use placeholders;
- selected/sort/filter fields must exist and be permitted;
- unknown operators fail closed;
- hard server-side maximum limit;
- bulk update/delete require an explicit caller filter.

Tasks:
- [x] Implement query parser.
- [x] Implement allowlisted SQL compiler.
- [x] Implement `readMany/readOne`.
- [x] Implement `createOne/createMany`.
- [x] Implement update methods with explicit filters.
- [x] Implement delete methods with explicit filters.
- [x] Add REST item routes as thin `ItemsService` adapters.
- [ ] Add relation expansion only after base CRUD is real-MySQL verified.
- [x] Add unit regression test sources for unknown fields/operators, placeholder boundaries and hidden-field filter/sort denial.
- [ ] Run SQL-injection regression suite against real MySQL/API.
- [ ] Add/run real-MySQL transaction rollback tests for bulk CRUD.

## 6. Authentication and sessions

V1:
- email/password login;
- refresh;
- logout current/all sessions;
- password-reset token lifecycle;
- email-verification token lifecycle;
- API tokens.

Security:
- maintained password-hashing primitive/library; no custom crypto algorithm;
- secure random tokens and hashed persistence where possible;
- server-side session revocation;
- explicit password-change session policy;
- auth rate limiting before production release.

Tasks:
- [x] Users repository/service.
- [x] Password hashing/verification.
- [x] Session creation/rotation/revocation.
- [x] Authentication middleware that replaces public accountability only after verified credentials.
- [x] Explicit public-role resolution for unauthenticated requests.
- [x] Refresh/logout endpoints.
- [x] Password reset one-time token lifecycle in core.
- [x] Email verification one-time token lifecycle in core.
- [x] API token lifecycle.
- [x] Add auth/token unit test sources and fail-closed guards.
- [ ] Add mail transport + public reset/verification delivery endpoints without account enumeration/token leakage.
- [ ] Add authentication rate limiting before production release.
- [ ] Run auth security/replay/revocation integration tests against real MySQL/API.

## 7. Roles and permissions

Permission record V1:
- role;
- collection;
- action: create/read/update/delete;
- field allowlist;
- row filter/condition JSON;
- optional create/update validation JSON after enforcement exists.

Rules:
- admin bypass explicit/system-defined;
- public role explicit;
- effective permissions cacheable by request/schema version;
- service-layer enforcement;
- extension service calls inherit permission behavior by default once extension runtime is wired.

Tasks:
- [x] Implement administrator/system-managed `RolesService` create/read foundation.
- [x] Implement `PermissionsService` exact role+collection+action resolution and create/read foundation.
- [x] Compile permission row filters through the same safe query compiler.
- [x] Enforce field-level read/filter/sort/write allowlists inside `ItemsService`.
- [x] Enforce permission row filters for read/update/delete inside `ItemsService`.
- [x] Fail closed for role-less/missing-permission access; explicit admin/system bypass only.
- [x] Reject permission validation metadata until validation enforcement exists.
- [ ] Implement create/update validation rules.
- [ ] Add effective-permission cache + safe invalidation.
- [x] Add unit regression sources for missing permissions, row restrictions and hidden-field inference boundaries.
- [ ] Run privilege-escalation regression suite against real MySQL/API.

## 8. Extension system

V1 extensions are trusted server-side JavaScript. Discovery supports local packages and npm-installed project dependencies with a `yuncms` manifest.

Familiar developer API:

```js
export default defineEndpoint((router, context) => {
  router.get('/', async (req, res) => {
    // use context.services directly; no self-HTTP request
  });
});
```

Hook concepts:
- `filter` before mutation;
- `action` after committed mutation;
- `init` lifecycle;
- scheduling later after runtime behavior is stable.

Tasks:
- [x] Create `@yuncms/extensions-sdk` package.
- [x] Implement `defineEndpoint`.
- [x] Implement `defineHook`.
- [x] Add basic SDK definition test sources.
- [x] Implement local/npm extension discovery and manifest validation.
- [x] Mount endpoint extensions under `/extensions/<id>` after authentication middleware.
- [x] Implement filter/action/init emitter with AsyncLocalStorage recursion-protection metadata.
- [x] Expose services/database/schema/accountability/logger/env/emitter in trusted runtime context.
- [x] Wire `app.beforeStart` and `app.afterStart` extension lifecycle around HTTP listen.
- [x] Add runtime test source proving hooks receive services/database directly without self-HTTP.
- [x] Add endpoint/hook extension examples.
- [x] Add extension authoring docs.
- [x] Align SDK/runtime extension marker contract so SDK definitions load correctly.
- [ ] Run local and npm-packed extension startup/accountability smoke tests.

## 9. Files and storage

Storage contract:
- `put`
- `get`
- `delete`
- `stat`
- `getSignedUrl` where supported

Drivers:
1. local filesystem;
2. S3-compatible storage.

Tasks:
- [ ] Define storage contract.
- [ ] Local driver.
- [ ] S3-compatible driver.
- [ ] `FilesService` metadata/storage coordination.
- [ ] Upload/download/delete routes.
- [ ] Path traversal protections.
- [ ] Orphan cleanup/reconciliation strategy.

## 10. Audit/schema history

- [ ] Record actor/action/collection/item/request id/timestamp.
- [ ] Record schema changes with before/after metadata where practical.
- [ ] Redact password/token/secret values.
- [ ] Retention configuration later; not required for prototype.

## 11. CLI + Directus-like setup wizard

Target:

```text
npx yuncms init
npx yuncms bootstrap
npx yuncms start
```

`init` wizard should:
1. verify Node version;
2. ask MySQL host/port/db/user/password with secret-safe input;
3. test connection;
4. write `.env` without echoing secrets afterward;
5. bootstrap migrations;
6. ask first admin email/password;
7. create admin role/user exactly once;
8. print API/Studio URLs and next command.

Rules:
- rerun/bootstrap idempotent;
- existing admin never silently recreated;
- setup failure retryable without corrupting state;
- non-zero exit + actionable errors on failure.

Tasks:
- [x] Create CLI package/dispatcher and executable bin entry.
- [x] Implement Node 24 runtime guard.
- [x] Implement config loader reusable by API/CLI.
- [ ] Implement `init` prompts.
- [x] Verify DB connectivity in the bootstrap command before migrations.
- [x] Implement bootstrap command with pool cleanup on success/failure.
- [x] Implement reusable first-administrator creation helper with duplicate-admin refusal.
- [ ] Wire initial administrator creation into interactive `init` flow.
- [ ] `start` command wrapper.
- [ ] Non-interactive env bootstrap for servers/containers beyond current environment-driven bootstrap command.
- [ ] Document final npm installation/publishing flow after package naming/auth is verified.

## 12. React Studio V1

Navigation target:
- Content
- Data Model
- Users
- Roles & Permissions
- Files

Content UI:
- collection list;
- generic table;
- schema-generated create/edit form;
- primitive controls first, relation picker later.

Data Model UI:
- create collection;
- add/edit/delete safe fields;
- add M2O/show O2M;
- M2M after backend support.

Tasks:
- [x] Scaffold React 19.2/Vite 8 Studio.
- [x] Build minimal responsive Studio shell/sidebar.
- [x] Add API `/health` status indicator.
- [ ] Add real API client/session handling.
- [ ] Login page.
- [ ] Generic collection table.
- [ ] Generic record form.
- [ ] Data Model collection list.
- [ ] Collection/field forms.
- [ ] Users screen.
- [ ] Roles/Permissions screen.
- [ ] Files screen after `FilesService`.
- [ ] Loading/error/empty states for real CRUD screens.
- [ ] Accessibility/keyboard baseline for interactive screens.

## 13. API runtime, errors and observability

Canonical error body:

```json
{
  "errors": [
    {
      "code": "INVALID_QUERY",
      "message": "Unknown filter operator: _foo",
      "path": "filter.status._foo",
      "request_id": "..."
    }
  ]
}
```

Tasks:
- [x] Create Express app/server runtime.
- [x] Add request IDs to current health/runtime responses.
- [x] Add `/health` process probe.
- [x] Add `/ready` MySQL readiness probe with HTTP 503 on DB failure.
- [x] Add graceful HTTP + MySQL shutdown path.
- [x] Add narrow Studio-origin CORS boundary for current shell.
- [x] Attach explicit public request context and current core service registry to API requests.
- [x] Refuse API startup when required core migrations/schema state are missing.
- [x] Define reusable API error/status mapping and canonical routed-error body.
- [x] Hide unexpected internal exception messages from HTTP responses.
- [ ] Add structured logging with secret redaction.
- [x] Normalize errors reaching the Express error middleware into one response contract.
- [x] Add API error-contract unit test sources.
- [ ] Run API smoke tests after dependencies are installed.

## 14. Testing strategy

No GitHub Actions. Tests run locally/Codex and results are recorded when relevant.

Layers:
- unit: query compiler, identifiers, permission behavior, token helpers;
- integration: real MySQL for schema/CRUD/auth/RBAC;
- API: HTTP behavior against test server + real MySQL;
- Studio: component tests only where useful;
- E2E later: Playwright for login/schema/CRUD/role isolation.

Critical regressions:
- SQL injection via collection/field/filter/sort;
- cross-role access and hidden-field inference;
- schema metadata/physical drift;
- concurrent DDL;
- deadlock retry correctness;
- session rotation/revocation;
- one-time reset/verification token replay;
- extension definition/runtime/accountability;
- file path traversal.

Tasks:
- [x] Add Node built-in test-runner baseline.
- [x] Add unit test sources for identifier safety, DB error normalization/retry and extension SDK definitions.
- [x] Add unit test sources for accountability/context, migration runner and advisory lock behavior.
- [x] Add unit test sources for field/query compiler and generic `ItemsService` SQL boundaries.
- [x] Add unit test sources for RBAC permission resolution, row filters, field restrictions and fail-closed access.
- [x] Add unit test sources for login/session/API-token/auth-action-token boundaries.
- [x] Add extension manifest/discovery/duplicate-id/runtime-context test sources.
- [x] Add API canonical-error unit test sources.
- [ ] Run current tests after local `npm install`.
- [ ] Real-MySQL integration harness.
- [ ] API smoke tests.
- [ ] Studio test baseline when UI has real interactions.
- [ ] Playwright after a meaningful authenticated E2E path exists.

## 15. Documentation

Write docs as behavior stabilizes; never document planned behavior as shipped.

- [x] `README.md` current-state overview.
- [x] `docs/architecture.md`.
- [x] `docs/development.md`.
- [x] `docs/database.md`.
- [x] `docs/rest-api.md`.
- [x] `docs/auth.md` for current auth/session/token surface and known transport limitation.
- [x] `docs/permissions.md` for current RBAC surface.
- [x] `docs/extensions.md` for discovery, endpoint/hook APIs, context, trust model and lifecycle.
- [ ] `docs/studio.md` when real Studio workflows exist.
- [x] `docs/setup-cli.md` for current bootstrap CLI surface.
- [ ] `docs/security.md`.
- [ ] `docs/deployment.md`.

## 16. Milestones

### Milestone A — runnable skeleton
Definition of done:
- npm workspaces exist;
- dependencies install and lockfile is reviewed;
- API starts on Node 24;
- MySQL pool/config exists;
- `/health` and `/ready` behave as documented;
- React Studio builds and starts;
- extension SDK initial names work;
- current non-MySQL tests pass.

- [ ] Milestone A complete. **Implementation is present; completion remains blocked on local install/build/runtime verification in `todo.md`.**

### Milestone B — schema + CRUD prototype
- bootstrap tables;
- collection + primitive field creation;
- generic CRUD;
- filters/sort/pagination;
- real-MySQL integration tests.

- [ ] Milestone B complete. **Code paths are implemented; completion remains blocked on real-MySQL/API verification in `todo.md`.**

### Milestone C — auth + RBAC
- users/sessions/login/refresh/logout;
- roles/permissions inside services;
- field + row restrictions;
- privilege/auth regression tests.

- [ ] Milestone C complete. **Core auth/RBAC code paths now exist; completion remains blocked on real-MySQL/API auth, replay, revocation and privilege verification in `todo.md`. Mail transport/rate limiting remain production-V1 work.**

### Milestone D — extensions + useful Studio
- endpoint/hook extensions load locally/npm;
- extensions receive services/context directly;
- Studio supports login, collections, CRUD, Data Model basics, users/roles basics.

- [ ] Milestone D complete. **Extension runtime/source-level coverage is implemented; Studio workflows and local/npm runtime verification remain.**

### Milestone E — useful production V1
- files local + S3-compatible;
- audit/history basics;
- setup wizard/bootstrap hardened;
- docs sufficient for a new project without reading source;
- npm packaging verified;
- production security checklist passes.

- [ ] Milestone E complete.

## 17. Current branch slice — `16-08-2026`

- [x] Add `AGENTS.md` with scope, architecture, commit and `plan.md` rules.
- [x] Add `todo.md` for environment/manual blockers.
- [x] Create npm workspace skeleton and runtime/toolchain policy.
- [x] Create core config + MySQL pool + transaction/error/retry helpers.
- [x] Create explicit accountability/request context + service registry foundation.
- [x] Create Express API factory/runtime + health/readiness + bootstrap compatibility guard.
- [x] Create extension SDK skeleton (`defineEndpoint`, `defineHook`).
- [x] Create React Studio shell + API health indicator.
- [x] Add bootstrap migration journal, system schema, advisory locks and schema version state.
- [x] Add versioned schema snapshot/cache with metadata+version commit discipline.
- [x] Add schema metadata repository and collection/field safe create/read/update foundations.
- [x] Add M2O create/delete plus O2M inverse read behavior.
- [x] Add allowlisted query compiler and generic `ItemsService` CRUD.
- [x] Add `RolesService`/`PermissionsService` and enforce field/row restrictions inside `ItemsService`.
- [x] Add generic item REST adapters and canonical API error middleware.
- [x] Add `yuncms` CLI package with Node guard and `bootstrap` command.
- [x] Add users/password/session login-refresh-logout and API-token authentication foundation.
- [x] Wire authenticated and explicit public-role accountability into the REST/RBAC path.
- [x] Add password-reset and email-verification one-time token lifecycle with migration `0004`.
- [x] Add reusable first-administrator creation helper.
- [x] Wire local/npm extension discovery, hook runtime, endpoint mounting and startup lifecycle.
- [x] Fix extension SDK/runtime definition-marker mismatch and add runtime-context regression source.
- [x] Keep extension code on direct services/context; no local self-HTTP behavior.
- [x] Add/update database, REST, auth, permission, extension and CLI documentation for shipped behavior.
- [x] Add non-MySQL unit test sources for bootstrap/context/query/CRUD/RBAC/auth/extensions/API contracts.
- [x] Record npm install/build/test and real-MySQL/schema/CRUD/RBAC/auth/API verification in `todo.md`.
- [ ] Local/Codex: run dependency install, tests, Studio build, bootstrap/API/extension smoke and real-MySQL verification; check Milestone A/B/C only after they pass.
- [ ] Next code slice: finish destructive schema operations + physical field mutation policy + M2M helper, then move into authenticated Studio workflows.
