# Development Setup

## Prerequisites

- Node.js 24 LTS
- npm 11+
- MySQL 8 for integration/bootstrap work

The repository contains the verified npm lockfile. Use Node.js 24 LTS and `npm install` to reproduce the workspace dependencies.

## Install

```bash
npm install
cp .env.example .env
```

Fill the MySQL values in `.env`. Do not commit `.env`.

## Run

For the normal single-port source runtime:

```bash
npm start
```

`npm start` builds Studio and serves the API and Studio from the configured API listener. `npm run dev` provides the watched API source workflow after an initial Studio build. Both use the project working directory, and the runtime loads a project-local `.env` when present.

## Validate current code

After dependencies are installed:

```bash
npm test
npm run build
```

Then check:

```text
GET http://127.0.0.1:8055/health
GET http://127.0.0.1:8055/ready
```

Expected behavior:
- `/health` returns HTTP 200 while the API process is running.
- `/ready` returns HTTP 200 only when `SELECT 1` succeeds against MySQL; otherwise HTTP 503.
- Studio shows the API health state from `/health`.

## Database testing

Use a disposable local MySQL database for early schema/bootstrap development. Never run destructive schema tests against production or a developer database containing useful data.

See `todo.md` for the exact manual checks that still require a local environment.

## Commit workflow

- Work on `16-08-2026` unless the owner starts a newer branch.
- No GitHub Actions.
- Keep commits focused.
- Do not mark `plan.md` items complete until behavior exists.
- Update `plan.md` immediately when implementation actually completes a roadmap item.
- Put only environment-blocked/manual work into `todo.md`.
