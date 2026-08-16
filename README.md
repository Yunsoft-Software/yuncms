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
packages/api               Express HTTP/auth runtime and thin REST adapters
packages/core              MySQL, bootstrap, schema/query/auth/RBAC services
packages/extensions-sdk    extension authoring helpers
packages/cli               YunCMS init/bootstrap CLI
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
- `RolesService` and `PermissionsService` with field allowlists and row filters;
- opaque session access/refresh tokens with refresh rotation and server-side revocation;
- scrypt password hashing and session invalidation on password change;
- static hashed API tokens with one-time secret return;
- authenticated/public-role request accountability;
- login/refresh/logout/logout-all/API-token REST routes;
- generic `/items/:collection` REST CRUD adapters and canonical API error handling;
- one-public-role constraints at service and MySQL levels;
- `defineEndpoint` / `defineHook` extension SDK helpers;
- interactive `yuncms init` and idempotent `yuncms bootstrap` commands;
- minimal React Studio shell and API health indicator.

M2M, destructive schema deletes, password-reset/email-verification lifecycles, auth rate limiting, permission validation rules, extension loading, files and most Studio screens are still roadmap work.

## Setup / local development

The repository is intentionally committed before dependency installation so the first local/Codex session can verify the dependency graph and create the lockfile explicitly.

Interactive first setup:

```bash
npm install
npm run init
npm run dev:api
npm run dev:studio
```

`npm run init` creates `.env` when missing, verifies MySQL, applies migrations and creates the first administrator exactly once. Existing `.env` and existing administrator state are reused on rerun rather than silently overwritten/recreated.

For an already configured environment:

```bash
npm run bootstrap
npm run dev:api
npm run dev:studio
```

The API performs a read-only migration compatibility check before listening; it does not silently bootstrap application state on startup.

API defaults to `http://127.0.0.1:8055` and Studio to `http://localhost:5173`.

Current probes:

```text
GET /health   process/API health without authentication/public-role lookup
GET /ready    live MySQL readiness; returns 503 when DB access fails
```

See [`docs/database.md`](./docs/database.md), [`docs/rest-api.md`](./docs/rest-api.md), [`docs/auth.md`](./docs/auth.md), [`docs/permissions.md`](./docs/permissions.md) and [`docs/setup-cli.md`](./docs/setup-cli.md) for current shipped behavior.

## Design rule that matters most

HTTP is an adapter, not the internal API. YunCMS services and future extensions call service/database APIs directly with explicit accountability instead of making self-HTTP requests back into the same server.

This keeps authorization, transactions and error handling in one process boundary and avoids the class of self-request problems that appear in larger plugin-heavy backends.
