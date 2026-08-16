# YunCMS Development Plan

> Status document. Every completed implementation item must be checked here when the implementation lands. `AGENTS.md` defines the working rules.

## 0. Product definition and non-goals

### Goal
Build a small, reusable Node.js backend platform inspired by the parts of Directus we actually use: schema-aware CRUD, auth/RBAC, files, server extensions, a setup CLI, and a minimal React Studio. YunCMS is an independent implementation; Directus is an architectural and UX reference, not a codebase to fork.

### Fixed constraints
- [x] Repository: `Uncw3b-Software/yuncms`.
- [x] Backend runtime baseline: Node.js 24 LTS.
- [x] Backend language: modern JavaScript/ESM; do not introduce TypeScript unless this plan is explicitly changed.
- [x] HTTP layer: Express 5.
- [x] Database: MySQL only for V1.
- [x] Database driver: `mysql2/promise` directly. No ORM, Knex, Prisma, Sequelize, query-builder abstraction, or second database driver.
- [x] Studio: React 19.2 with Vite 8.
- [x] Package manager/workspaces: npm workspaces.
- [x] API style: REST only. Do not add GraphQL.
- [x] Extensions should feel familiar to Directus extension authors, while keeping YunCMS APIs independent and intentionally smaller.
- [x] No GitHub Actions in this project unless the owner explicitly changes this rule.
- [x] Work in small, focused commits.
- [x] Keep implementation docs current as code lands.

### Explicit V1 non-goals
- [x] No GraphQL.
- [x] No visual Flow builder.
- [x] No dashboard/Insights builder.
- [x] No Vue.
- [x] No multi-database abstraction.
- [x] No AI/MCP features in core.
- [x] No SSO/SAML/LDAP in the first milestone.
- [x] No extension marketplace or untrusted extension sandbox in the first milestone.
- [x] No visual ER-diagram editor in the first Studio milestone.
- [x] No content versioning/translations/presets/bookmarks in the first milestone.

## 1. Target repository shape

```text
yuncms/
├── apps/
│   └── studio/                 # React Studio
├── packages/
│   ├── api/                    # Express app, REST routes, request context
│   ├── core/                   # DB, services, schema engine, auth/RBAC
│   ├── extensions-sdk/         # defineEndpoint/defineHook and extension contracts
│   └── cli/                    # init/bootstrap/start commands and setup wizard
├── docs/                       # architecture + extension/API guides
├── examples/                   # later: extension examples and starter project
├── AGENTS.md
├── plan.md
└── todo.md
```

- [ ] Create npm workspace skeleton.
- [ ] Add shared root scripts without introducing a build orchestrator.
- [ ] Add `.gitignore`, `.editorconfig`, and environment example.
- [ ] Add package READMEs only when each package has a real public contract.

## 2. Core architecture rules

### 2.1 Request context / accountability
Every request and extension callback receives an explicit context. Services never infer authorization from global state.

Target shape:

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
- Public access must be explicit; `null` must never silently mean administrator.
- HTTP routes call services; internal code/extensions must not call YunCMS' own HTTP API to perform local work.
- System-only operations use an explicit internal/system accountability object.
- [ ] Implement request context factory.
- [ ] Implement explicit public/system accountability helpers.
- [ ] Add context propagation tests.

### 2.2 Service layer
Directus-like service names are used because they are familiar and map cleanly to responsibilities:
- `ItemsService`
- `CollectionsService`
- `FieldsService`
- `RelationsService`
- `UsersService`
- `RolesService`
- `PermissionsService`
- `FilesService`

Rules:
- HTTP endpoints are thin wrappers around services.
- Dedicated system services may extend/reuse generic item operations but must own special behavior such as password hashing/session invalidation.
- Service calls accept the active connection/transaction and accountability.
- [ ] Define base service contracts.
- [ ] Implement service registry exposed to API routes and extensions.

### 2.3 Database layer
Keep SQL visible and MySQL-specific rather than hiding it behind an ORM.

- [ ] Create one `mysql2/promise` pool factory.
- [ ] Add connection health check and graceful shutdown.
- [ ] Add transaction helper that pins one connection and guarantees rollback/release.
- [ ] Add safe identifier validation/quoting helper.
- [ ] Require placeholders for all data values.
- [ ] Add MySQL error normalization for duplicate keys, FK failures, deadlocks, lock wait timeouts, and connection errors.
- [ ] Add bounded deadlock/lock-timeout retry helper only around operations proven safe to retry.

## 3. System metadata and bootstrap schema

System tables use a reserved prefix and are never treated as ordinary user collections unless a dedicated service explicitly allows it.

Initial tables:
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
- `yuncms_audit_log`

### Bootstrap invariants
- Metadata changes and physical schema changes must not drift silently.
- Schema mutations are serialized using a MySQL advisory lock (project-specific lock key).
- Every successful schema mutation increments/persists a schema version.
- Startup verifies required system tables/migration version before serving requests.
- Destructive schema operations require explicit intent.

Tasks:
- [ ] Define bootstrap SQL/migration format.
- [ ] Implement migration journal.
- [ ] Implement bootstrap runner.
- [ ] Implement schema advisory lock helper.
- [ ] Implement schema version reader/writer.
- [ ] Implement startup compatibility checks.
- [ ] Add bootstrap idempotency tests against real MySQL.

## 4. Dynamic schema engine

### CollectionsService V1
- Create collection/table.
- Rename collection later; do not include until rename semantics are tested.
- Update collection metadata.
- Delete collection only with explicit destructive flag.
- Read/list collections.

### FieldsService V1
Supported physical field families initially:
- integer / big integer
- decimal
- string / text
- boolean
- date / datetime / timestamp
- json
- uuid stored as `char(36)` initially

Operations:
- Add field.
- Update safe metadata.
- Change nullable/default/index only through validated operations.
- Delete field only with explicit destructive flag.
- Type change is postponed until a conversion-safety policy exists.

### RelationsService V1
- M2O represented by a physical FK field.
- O2M represented as metadata inverse of an M2O.
- M2M represented by an explicit junction collection.
- Validate FK type compatibility before DDL.
- Support `RESTRICT`, `CASCADE`, `SET NULL` only when structurally valid.

Tasks:
- [ ] Build schema metadata repository.
- [ ] Build collections create/read/delete path.
- [ ] Build fields create/read/update/delete path.
- [ ] Build M2O relation creation/deletion.
- [ ] Build O2M metadata representation.
- [ ] Build M2M junction helper.
- [ ] Add schema cache keyed by schema version.
- [ ] Invalidate cache only after committed DDL/metadata transaction.
- [ ] Add concurrent schema mutation tests.
- [ ] Add partial-failure recovery tests.

## 5. Generic ItemsService and REST query language

REST shape:

```text
GET    /items/:collection
GET    /items/:collection/:id
POST   /items/:collection
PATCH  /items/:collection/:id
DELETE /items/:collection/:id
```

### Query V1
- `fields`
- `filter`
- `sort`
- `limit`
- `offset`
- basic metadata count

### Filter V1
Allowlisted operators only:
- `_eq`, `_neq`
- `_lt`, `_lte`, `_gt`, `_gte`
- `_in`, `_nin`
- `_null`, `_nnull`
- `_contains`, `_starts_with`, `_ends_with`
- `_and`, `_or`

Security rules:
- Collection and field names are resolved from schema metadata, never trusted directly from the URL/query.
- Values use placeholders.
- Sort and selected fields must exist and be permitted.
- Unknown operators fail closed.
- A hard server-side maximum limit is enforced.

Tasks:
- [ ] Implement query parser.
- [ ] Implement SQL compiler for allowlisted operators.
- [ ] Implement `ItemsService.readMany`.
- [ ] Implement `readOne`.
- [ ] Implement `createOne/createMany`.
- [ ] Implement `updateOne/updateMany` with explicit filters.
- [ ] Implement `deleteOne/deleteMany` with explicit filters.
- [ ] Add relation expansion only after base CRUD is stable.
- [ ] Add REST item routes.
- [ ] Add SQL-injection regression tests.
- [ ] Add transaction/rollback tests.

## 6. Authentication and sessions

V1 auth:
- Email + password.
- Login.
- Refresh.
- Logout current session.
- Logout all sessions.
- Password reset tokens.
- Email verification tokens (transport abstraction can come later; token lifecycle first).
- Static API tokens.

Security choices:
- Password hashing uses a maintained password-hashing library; no custom crypto.
- Refresh/reset/verification/API tokens are generated with cryptographically secure randomness and persisted as hashes where possible.
- Session revocation is server-side.
- Password changes invalidate old sessions according to explicit policy.
- Authentication rate limiting is required before production release.

Tasks:
- [ ] Implement users repository/service.
- [ ] Implement password hashing/verification.
- [ ] Implement session creation/rotation/revocation.
- [ ] Implement access authentication middleware.
- [ ] Implement refresh endpoint.
- [ ] Implement logout endpoints.
- [ ] Implement password reset token lifecycle.
- [ ] Implement email verification token lifecycle.
- [ ] Implement API token lifecycle.
- [ ] Add auth security tests.

## 7. Roles and permissions

Permission record V1:
- role
- collection
- action: `create/read/update/delete`
- field allowlist
- filter/condition JSON
- optional validation JSON for create/update

Rules:
- Administrator bypass is explicit and limited to system-defined admin role/accountability.
- Public permissions use an explicit public role/accountability.
- Effective permission is calculated once per request/schema version where practical.
- Permissions are enforced inside services, not only in HTTP middleware.
- Extensions using services receive the same enforcement by default.

Tasks:
- [ ] Implement roles service.
- [ ] Implement permissions service.
- [ ] Compile permission filters into the same safe query compiler used by ItemsService.
- [ ] Enforce field-level read/write allowlists.
- [ ] Enforce row filters on reads/updates/deletes.
- [ ] Enforce create/update validation rules.
- [ ] Add permission cache with safe invalidation.
- [ ] Add privilege-escalation regression suite.

## 8. Extension system

The first extension runtime is trusted, server-side code. No marketplace sandbox yet.

### Package discovery
Support local extensions and npm-installed packages declaring a `yuncms` manifest in `package.json`.

Proposed manifest:

```json
{
  "yuncms": {
    "type": "endpoint",
    "entry": "./dist/index.js"
  }
}
```

### Endpoint extension API
Familiar shape:

```js
export default defineEndpoint((router, context) => {
  router.get('/', async (req, res) => {
    const service = new context.services.ItemsService('orders', {
      accountability: req.accountability,
      schema: await context.getSchema()
    });

    res.json(await service.readMany({ limit: 10 }));
  });
});
```

### Hook extension API
Familiar concepts:
- `filter(event, handler)` before mutation; can transform/reject.
- `action(event, handler)` after committed mutation.
- `init(event, handler)` lifecycle.
- `schedule(cron, handler)` postponed until scheduler behavior is proven.

Initial event names should remain small and predictable:
- `items.create`
- `items.update`
- `items.delete`
- collection-specific metadata in event payload rather than thousands of event names.

Tasks:
- [ ] Create `@yuncms/extensions-sdk` package.
- [ ] Implement `defineEndpoint`.
- [ ] Implement `defineHook`.
- [ ] Implement extension discovery/manifest validation.
- [ ] Mount endpoint extensions under `/extensions/<name>` by default.
- [ ] Implement filter/action emitter with recursion protection metadata.
- [ ] Expose services/database/schema/accountability/logger/env in context.
- [ ] Ensure extension service calls do not self-request over HTTP.
- [ ] Add extension examples.
- [ ] Add extension authoring docs.

## 9. Files and storage

Storage interface:
- `put`
- `get`
- `delete`
- `stat`
- `getSignedUrl` when supported

Drivers:
1. Local filesystem.
2. S3-compatible object storage.

Tasks:
- [ ] Define storage driver contract.
- [ ] Implement local driver.
- [ ] Implement S3-compatible driver.
- [ ] Implement `FilesService` metadata + storage coordination.
- [ ] Add upload/download/delete REST routes.
- [ ] Add filename/path traversal protections.
- [ ] Add orphan-file cleanup/reconciliation strategy.

## 10. Audit and schema history

- [ ] Record actor, action, collection, item key, request id, timestamp.
- [ ] Record schema changes separately with before/after metadata where practical.
- [ ] Redact password/token/secret fields.
- [ ] Add configurable audit retention later; not required for prototype.

## 11. CLI and Directus-like setup experience

Target flows:

```text
npx yuncms init
npx yuncms bootstrap
npx yuncms start
```

`init` wizard should:
1. Verify supported Node version.
2. Ask MySQL host/port/database/user/password.
3. Test connection.
4. Write `.env` without printing secrets afterward.
5. Run/bootstrap system migrations.
6. Ask initial admin email/password.
7. Create administrator role/user once.
8. Print local API/Studio URLs and next command.

Rules:
- Rerunning bootstrap must be idempotent.
- Existing admin is never silently recreated.
- Setup failure must preserve enough state to retry safely.
- CLI exits non-zero on failure and prints actionable error codes/messages.

Tasks:
- [ ] Create CLI package/command dispatcher.
- [ ] Implement config loader shared with API.
- [ ] Implement `init` prompts.
- [ ] Implement DB connection verification.
- [ ] Implement bootstrap command.
- [ ] Implement initial admin creation.
- [ ] Implement `start` command.
- [ ] Add non-interactive env-based bootstrap mode for servers/containers.
- [ ] Document npm installation/publishing flow.

## 12. React Studio V1

Keep Studio deliberately boring and useful.

### Navigation
- Content / collections.
- Data Model.
- Users.
- Roles & Permissions.
- Files.
- Settings/extensions status later.

### Content UI
- Collection list.
- Generic table view.
- Create/edit form generated from field metadata.
- Primitive inputs first; relation picker after relation API is stable.

### Data Model UI
- Create collection.
- Add/edit/delete safe fields.
- Add M2O relation.
- Show O2M inverse.
- M2M helper after API support.

Tasks:
- [ ] Scaffold React 19.2/Vite 8 Studio.
- [ ] Add API client/session handling.
- [ ] Build login page.
- [ ] Build Studio shell/sidebar.
- [ ] Build generic collection table.
- [ ] Build generic record form.
- [ ] Build Data Model collection list.
- [ ] Build collection/field forms.
- [ ] Build Users screen.
- [ ] Build Roles/Permissions screen.
- [ ] Build Files screen after FilesService.
- [ ] Add loading/error/empty states.
- [ ] Keep accessibility and keyboard navigation in the component baseline.

## 13. API error contract and observability

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
- [ ] Define error classes/codes.
- [ ] Add request IDs.
- [ ] Add structured logging with secret redaction.
- [ ] Normalize Express errors into one response contract.
- [ ] Add health/readiness endpoints.

## 14. Testing strategy

No GitHub Actions. Tests are run locally/Codex and results are recorded in commit/PR notes when relevant.

Layers:
- Unit: query compiler, identifiers, permission merging, token helpers.
- Integration: real MySQL for schema/CRUD/auth/RBAC.
- API: HTTP behavior against test server + real MySQL.
- Studio: component tests where valuable.
- E2E later: Playwright for login, collection creation, CRUD, role isolation.

Critical regression groups:
- SQL injection via collection/field/filter/sort.
- Cross-role data access.
- Schema metadata/physical schema drift.
- Concurrent DDL.
- Deadlock retry correctness.
- Session invalidation/rotation.
- Extension authorization inheritance.
- File path traversal.

Tasks:
- [ ] Add Node test runner baseline.
- [ ] Add real-MySQL integration test harness.
- [ ] Add API smoke tests.
- [ ] Add Studio test baseline.
- [ ] Add Playwright only when Studio has a meaningful end-to-end path.

## 15. Documentation set

Docs should be written as implementation stabilizes, not postponed to the end.

Planned docs:
- [ ] `docs/architecture.md`
- [ ] `docs/database.md`
- [ ] `docs/rest-api.md`
- [ ] `docs/auth.md`
- [ ] `docs/permissions.md`
- [ ] `docs/extensions.md`
- [ ] `docs/studio.md`
- [ ] `docs/setup-cli.md`
- [ ] `docs/security.md`
- [ ] `docs/deployment.md`

## 16. Milestones

### Milestone A — runnable skeleton
Definition of done:
- npm workspaces exist.
- API starts on Node 24.
- MySQL pool/config layer exists.
- `/health` and `/ready` exist.
- React Studio dev shell exists.
- Extension SDK package has stable initial names.
- [ ] Milestone A complete.

### Milestone B — schema + CRUD prototype
Definition of done:
- bootstrap tables.
- collection + primitive field creation.
- generic CRUD.
- filters/sort/pagination.
- real MySQL integration tests.
- [ ] Milestone B complete.

### Milestone C — auth + RBAC
Definition of done:
- users/sessions/login/refresh/logout.
- roles/permissions enforced inside services.
- field + row restrictions.
- privilege regression tests.
- [ ] Milestone C complete.

### Milestone D — extensions + minimal Studio
Definition of done:
- endpoint and hook extensions load locally/npm.
- extensions get services/context directly.
- Studio supports login, collections, generic CRUD, data model basics, users/roles basics.
- [ ] Milestone D complete.

### Milestone E — useful V1
Definition of done:
- files local + S3-compatible.
- audit/history basics.
- setup wizard/bootstrap hardened.
- documentation complete enough for a new project without reading source.
- npm packaging verified.
- production security checklist passes.
- [ ] Milestone E complete.

## 17. First implementation slice

This is the immediate sequence for the current branch:
- [ ] Add `AGENTS.md` with scope, architectural rules, commit rules, and mandatory `plan.md` updates.
- [ ] Add `todo.md` for environment-blocked/manual work.
- [ ] Create npm workspace skeleton and pinned runtime/toolchain policy.
- [ ] Create core config + MySQL pool + transaction helpers.
- [ ] Create Express API factory and health/readiness endpoints.
- [ ] Create extension SDK skeleton (`defineEndpoint`, `defineHook`).
- [ ] Create React Studio shell with a backend health indicator.
- [ ] Add architecture/setup documentation for what actually exists.
- [ ] Add tests that do not require MySQL in this environment.
- [ ] Record real-MySQL/npm-install commands that still need to be run in `todo.md`.
