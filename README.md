# YunCMS

YunCMS is a small, reusable Node.js backend platform for projects that need the parts of Directus we use most without carrying the whole Directus product surface.

It is an independent implementation. Directus is used as an architectural and developer-ergonomics reference; YunCMS is not a fork and does not aim for full API compatibility.

## Current direction

- Node.js 24 LTS
- JavaScript / ESM
- Express 5 REST API
- MySQL only via `mysql2/promise`
- React 19.2 Studio with Vite 8
- npm workspaces
- no GraphQL
- no ORM/query builder
- no GitHub Actions

See [`plan.md`](./plan.md) for the roadmap/status, [`AGENTS.md`](./AGENTS.md) for implementation rules, and [`todo.md`](./todo.md) for local/environment work that still requires Codex or a developer machine.

## Repository layout

```text
apps/studio                React Studio shell
packages/api               Express HTTP runtime and thin REST adapters
packages/core              MySQL, bootstrap, schema/query/RBAC service foundations
packages/extensions-sdk    extension authoring helpers
packages/cli               YunCMS CLI; bootstrap command is implemented
```

## Implemented backend slice

Current code includes:

- MySQL pool, pinned transactions, normalized DB errors and bounded retry helpers;
- explicit public/system/user accountability and request context;
- versioned system bootstrap with a migration journal and MySQL advisory lock;
- `yuncms_*` metadata/auth/file/audit foundation tables;
- schema version state and a version-aware schema snapshot cache;
- `CollectionsService` create/read/list plus safe metadata-only updates;
- `FieldsService` primitive field create/read plus safe metadata-only updates;
- `RelationsService` validated M2O create/delete and O2M inverse reads;
- allowlisted item filter/sort/field query compiler;
- generic `ItemsService` CRUD with service-layer role permission enforcement;
- `RolesService` and `PermissionsService` foundations with field allowlists and row filters;
- generic `/items/:collection` REST CRUD adapters and a canonical API error response middleware;
- `defineEndpoint` / `defineHook` extension SDK helpers;
- `yuncms bootstrap` CLI command;
- minimal React Studio shell and API health indicator.

M2M, destructive schema deletes, authentication/session middleware, permission validation rules, extension loading, files, the interactive setup wizard and most Studio screens are still roadmap work.

The HTTP API currently assigns role-less public accountability because authentication is not implemented yet. Item routes therefore fail closed with `FORBIDDEN` rather than temporarily exposing CRUD. Explicit public-role and authenticated-role assignment will land with auth.

## Local development

The repository is intentionally committed before dependency installation so the first local/Codex session can verify the dependency graph and create the lockfile explicitly.

```bash
npm install
cp .env.example .env
npm run bootstrap
npm run dev:api
npm run dev:studio
```

`npm run bootstrap` must succeed before the API will listen. Startup performs a read-only compatibility check and refuses an unbootstrapped/incompatible database instead of silently mutating it.

API defaults to `http://127.0.0.1:8055` and Studio to `http://localhost:5173`.

Current API probes:

```text
GET /health   process/API health after the server has passed startup compatibility checks
GET /ready    live MySQL readiness; returns 503 when DB access fails after startup
```

See [`docs/database.md`](./docs/database.md), [`docs/rest-api.md`](./docs/rest-api.md) and [`docs/setup-cli.md`](./docs/setup-cli.md) for the currently implemented database/API/CLI behavior.

## Design rule that matters most

HTTP is an adapter, not the internal API. YunCMS services and extensions call service/database APIs directly with explicit accountability instead of making self-HTTP requests back into the same server.

This keeps authorization, transactions and error handling in one process boundary and avoids the class of self-request problems that appear in larger plugin-heavy backends.
