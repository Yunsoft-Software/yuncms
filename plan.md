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
│   └── cli/                # planned
├── docs/
├── examples/               # later
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
- [x] Add context propagation/accountability tests.

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
- [ ] Expose the same registry through the extension runtime once discovery/loading exists.
- [ ] Ensure dedicated system services own special behavior such as password hashing/session invalidation.

### 2.3 MySQL foundation
- [x] Create one `mysql2/promise` pool factory.
- [x] Add DB health check and graceful pool shutdown.
- [x] Add transaction helper that pins a connection and guarantees rollback/release.
- [x] Add safe SQL identifier validation/quoting helper.
- [x] Disable multi-statements in pool configuration.
- [x] Add MySQL error normalization for duplicate/FK/deadlock/lock/connection classes.
- [x] Add bounded deadlock/lock-timeout retry helper.
- [x] Use placeholders for data values in current metadata/schema services; keep this invariant for future services.
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
- [x] Add unit tests for migration runner and advisory lock contracts.
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
- [ ] Build collection safe-metadata update + explicit destructive delete path.
- [x] Build primitive field type compiler and fields create/read path.
- [ ] Build field safe update + explicit destructive delete path.
- [x] Build M2O creation with FK/type/on-delete validation and cleanup compensation.
- [ ] Build M2O delete path.
- [ ] Build O2M inverse representation/read API.
- [ ] Build M2M junction helper.
- [ ] Add schema cache keyed by schema version.
- [ ] Invalidate cache only after committed mutation.
- [ ] Add concurrent DDL tests.
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
- selected/sort fields must exist and be permitted;
- unknown operators fail closed;
- hard server-side maximum limit.

Tasks:
- [ ] Implement query parser.
- [ ] Implement allowlisted SQL compiler.
- [ ] Implement `readMany/readOne`.
- [ ] Implement `createOne/createMany`.
- [ ] Implement update methods with explicit filters.
- [ ] Implement delete methods with explicit filters.
- [ ] Add REST item routes.
- [ ] Add relation expansion only after base CRUD is stable.
- [ ] Add SQL-injection regression tests.
- [ ] Add rollback tests.

## 6. Authentication and sessions

V1:
- email/password login;
- refresh;
- logout current/all sessions;
- password-reset token lifecycle;
- email-verification token lifecycle;
- API tokens.

Security:
- maintained password-hashing library; no custom crypto;
- secure random tokens and hashed persistence where possible;
- server-side session revocation;
- explicit password-change session policy;
- auth rate limiting before production release.

Tasks:
- [ ] Users repository/service.
- [ ] Password hashing/verification.
- [ ] Session creation/rotation/revocation.
- [ ] Authentication middleware.
- [ ] Refresh/logout endpoints.
- [ ] Password reset lifecycle.
- [ ] Email verification lifecycle.
- [ ] API token lifecycle.
- [ ] Auth security tests.

## 7. Roles and permissions

Permission record V1:
- role;
- collection;
- action: create/read/update/delete;
- field allowlist;
- row filter/condition JSON;
- optional create/update validation JSON.

Rules:
- admin bypass explicit/system-defined;
- public role explicit;
- effective permissions cacheable by request/schema version;
- service-layer enforcement;
- extension service calls inherit permission behavior by default.

Tasks:
- [ ] Roles service.
- [ ] Permissions service.
- [ ] Compile permission filters through the same safe query compiler.
- [ ] Field-level read/write allowlists.
- [ ] Row filtering for read/update/delete.
- [ ] Create/update validation rules.
- [ ] Permission cache + safe invalidation.
- [ ] Privilege-escalation regression suite.

## 8. Extension system

V1 extensions are trusted server-side JavaScript. Discovery should support local packages and later npm packages with a `yuncms` manifest.

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
- [x] Add basic SDK definition tests.
- [ ] Implement extension discovery/manifest validation.
- [ ] Mount endpoint extensions under `/extensions/<name>`.
- [ ] Implement filter/action emitter with recursion-protection metadata.
- [ ] Expose services/database/schema/accountability/logger/env in runtime context.
- [ ] Add runtime test proving extension service calls do not self-request HTTP.
- [ ] Add extension examples.
- [ ] Add extension authoring docs.

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
- [ ] Create CLI package/dispatcher.
- [x] Implement config loader reusable by API/CLI.
- [ ] Implement `init` prompts.
- [ ] DB connection verification command.
- [ ] Bootstrap command.
- [ ] Initial admin creation.
- [ ] `start` command.
- [ ] Non-interactive env bootstrap for servers/containers.
- [ ] Document final npm installation/publishing flow.

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

Canonical future error body:

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
- [ ] Define reusable API error classes/codes.
- [ ] Add structured logging with secret redaction.
- [ ] Normalize all Express errors into one response contract.
- [ ] Add API smoke tests after dependencies are installed.

## 14. Testing strategy

No GitHub Actions. Tests run locally/Codex and results are recorded when relevant.

Layers:
- unit: query compiler, identifiers, permission merge, token helpers;
- integration: real MySQL for schema/CRUD/auth/RBAC;
- API: HTTP behavior against test server + real MySQL;
- Studio: component tests only where useful;
- E2E later: Playwright for login/schema/CRUD/role isolation.

Critical regressions:
- SQL injection via collection/field/filter/sort;
- cross-role access;
- schema metadata/physical drift;
- concurrent DDL;
- deadlock retry correctness;
- session rotation/revocation;
- extension accountability;
- file path traversal.

Tasks:
- [x] Add Node built-in test-runner baseline.
- [x] Add unit tests for identifier safety, DB error normalization/retry and extension SDK definitions.
- [x] Add unit test sources for accountability/context, migration runner and advisory lock behavior.
- [ ] Run current tests after local `npm install`.
- [ ] Real-MySQL integration harness.
- [ ] API smoke tests.
- [ ] Studio test baseline when UI has real interactions.
- [ ] Playwright after a meaningful E2E path exists.

## 15. Documentation

Write docs as behavior stabilizes; never document planned behavior as shipped.

- [x] `README.md` current-state overview.
- [x] `docs/architecture.md`.
- [x] `docs/development.md`.
- [ ] `docs/database.md`.
- [ ] `docs/rest-api.md`.
- [ ] `docs/auth.md`.
- [ ] `docs/permissions.md`.
- [ ] `docs/extensions.md`.
- [ ] `docs/studio.md`.
- [ ] `docs/setup-cli.md`.
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

- [ ] Milestone A complete. **Blocked only on local install/build/runtime verification; see `todo.md`.**

### Milestone B — schema + CRUD prototype
- bootstrap tables;
- collection + primitive field creation;
- generic CRUD;
- filters/sort/pagination;
- real-MySQL integration tests.

- [ ] Milestone B complete.

### Milestone C — auth + RBAC
- users/sessions/login/refresh/logout;
- roles/permissions inside services;
- field + row restrictions;
- privilege regression tests.

- [ ] Milestone C complete.

### Milestone D — extensions + useful Studio
- endpoint/hook extensions load locally/npm;
- extensions receive services/context directly;
- Studio supports login, collections, CRUD, Data Model basics, users/roles basics.

- [ ] Milestone D complete.

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
- [x] Add bootstrap migration journal, system schema, advisory lock and schema version state.
- [x] Add schema metadata repository and first `CollectionsService`/`FieldsService`/`RelationsService` create/read operations.
- [x] Add architecture/development documentation for shipped baseline behavior.
- [x] Add non-MySQL unit test sources including bootstrap/context contracts.
- [x] Record npm install/build/test and real-MySQL checks in `todo.md`.
- [ ] Local/Codex: run dependency install, tests, Studio build, API/bootstrap smoke and real-MySQL checks; then check Milestone A if all pass.
- [ ] Next code slice: schema snapshot/cache, remaining safe schema operations, then generic query compiler/ItemsService.
