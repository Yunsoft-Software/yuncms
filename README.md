# YunCMS

YunCMS is a small reusable Node.js backend platform for projects that need the Directus-style capabilities we use most without carrying the whole Directus product surface.

It is an independent implementation, not a fork and not a Directus API-compatibility project.

## Baseline

- Node.js 24 LTS
- JavaScript / ESM
- Express 5 REST API
- MySQL only via `mysql2/promise`
- React 19.2 Studio with Vite 8
- npm workspaces
- no GraphQL
- no ORM/query builder
- no GitHub Actions

See [`plan.md`](./plan.md) for source status, [`AGENTS.md`](./AGENTS.md) for implementation rules and [`todo.md`](./todo.md) for checks that still require a real install/MySQL/provider/runtime environment.

## Repository

```text
apps/studio                React administration UI
packages/api               Express API/runtime and REST adapters
packages/core              MySQL/schema/items/auth/RBAC/files/audit runtime
packages/extensions-sdk    defineEndpoint/defineHook authoring helpers
packages/cli               init/bootstrap/start CLI
examples/extensions        endpoint + hook examples
docs                       architecture/operations/security/API docs
```

## Current V1 source surface

### Schema and data

- versioned MySQL bootstrap/migration journal;
- schema version/cache and advisory-lock serialized DDL;
- collection/field create/read/update/destructive-delete lifecycles;
- field required/default/index mutations;
- M2O create/delete + O2M inverse metadata;
- M2M junction create + high-level destructive junction delete;
- generic ItemsService CRUD;
- allowlisted fields/filter/sort/limit/offset query language;
- one-level direct M2O `expand` reads with source/target RBAC preserved.

### Authentication and RBAC

- scrypt password hashing;
- opaque access/refresh sessions with rotation/revocation;
- API tokens;
- password reset + email verification one-time tokens;
- Nodemailer SMTP delivery;
- process-local configurable auth rate limits;
- public/admin/system accountability;
- role CRUD, permission field allowlists, row filters and create/update validation;
- request-local permission cache;
- auth responses marked `no-store`.

### Extensions

- `defineEndpoint` / `defineHook` SDK;
- local and npm dependency discovery;
- authenticated endpoint mount under `/extensions/<id>`;
- filter/action/init hooks with recursion protection;
- trusted context with services/database/schema/accountability/logger/storage;
- direct service use; no YunCMS self-HTTP requirement.

### Files, audit and operations

- local storage + S3-compatible AWS SDK v3 driver;
- file metadata/upload/download/update/delete;
- storage inventory and guarded orphan reconciliation;
- audit records for item/file/schema mutations;
- recursive secret redaction;
- explicit batched audit retention cleanup;
- structured JSON runtime logs;
- request ids, health/readiness, baseline security headers and graceful shutdown.

### Studio

- login/logout/refresh;
- password-reset and verification link flows;
- generic content table + create/edit form;
- direct M2O relation pickers/display labels;
- collection/field/M2O/M2M Data Model workflows;
- M2M junction delete control;
- users management + verification action;
- roles/permissions + validation editor;
- file management.

Source presence is not a production-readiness claim. `todo.md` deliberately keeps real MySQL, build, SMTP, S3, browser, concurrency and package-install verification open until executed.

## Install from npm

YunCMS `0.1.0` is published under the `@yunsoft` organization:

```bash
npm install @yunsoft/yuncms
npx yuncms init
npx yuncms start
```

Node.js 24 LTS and MySQL are required. See [`docs/publishing.md`](./docs/publishing.md) for the package family and release details.

## Setup / development

First local validation should use Node 24 and a disposable MySQL database:

```bash
npm install
npm run init
npm run dev:api
npm run dev:studio
```

For an already configured database:

```bash
npm run bootstrap
npm run dev:api
npm run dev:studio
```

The published package-level commands are:

```text
npx yuncms init
npx yuncms bootstrap
npx yuncms start
```

The public registry package, CLI bootstrap and single-port API/Studio runtime have been verified from a clean consumer directory. Release policy is documented in [`docs/publishing.md`](./docs/publishing.md).

## Runtime probes

```text
GET /health
GET /ready
```

API default: `http://127.0.0.1:3008`
Studio default: `http://localhost:5173`

## Core design rule

HTTP is an adapter, not YunCMS's internal API.

Services and trusted extensions call service/database APIs directly with explicit accountability. They do not send requests back into the same YunCMS HTTP server. This keeps authorization, transactions, hooks and error handling on one internal service path.

## Documentation

Start with:

- [`docs/architecture.md`](./docs/architecture.md)
- [`docs/database.md`](./docs/database.md)
- [`docs/rest-api.md`](./docs/rest-api.md)
- [`docs/auth.md`](./docs/auth.md)
- [`docs/permissions.md`](./docs/permissions.md)
- [`docs/extensions.md`](./docs/extensions.md)
- [`docs/files.md`](./docs/files.md)
- [`docs/studio.md`](./docs/studio.md)
- [`docs/security.md`](./docs/security.md)
- [`docs/deployment.md`](./docs/deployment.md)
- [`docs/setup-cli.md`](./docs/setup-cli.md)
- [`docs/publishing.md`](./docs/publishing.md)
