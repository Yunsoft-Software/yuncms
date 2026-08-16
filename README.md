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
apps/studio                React Studio
packages/api               Express HTTP runtime
packages/core              config, MySQL and core service foundations
packages/extensions-sdk    extension authoring helpers
```

The CLI, schema engine, ItemsService, auth/RBAC, file storage and real extension loader are planned but are not implemented yet.

## Local development

The repository is intentionally committed before dependency installation so the first local/Codex session can verify the dependency graph and create the lockfile explicitly.

```bash
npm install
cp .env.example .env
npm run dev:api
npm run dev:studio
```

API defaults to `http://127.0.0.1:8055` and Studio to `http://localhost:5173`.

Current API probes:

```text
GET /health   process/API health; does not require a successful DB query
GET /ready    MySQL readiness; returns 503 while DB is unavailable
```

## Design rule that matters most

HTTP is an adapter, not the internal API. YunCMS services and extensions will call service/database APIs directly with explicit accountability instead of making self-HTTP requests back into the same server.

This keeps authorization, transactions and error handling in one process boundary and avoids the class of self-request problems that appear in larger plugin-heavy backends.
