# Development Setup

## Prerequisites

- Node.js 24 LTS
- npm 11+
- MySQL 8 for integration/bootstrap work

The current repository intentionally does not contain a generated lockfile yet because dependency installation cannot be verified from the GitHub connector environment. The first local/Codex session should run `npm install`, inspect the result and commit `package-lock.json` if clean.

## Install

```bash
npm install
cp .env.example .env
```

Fill the MySQL values in `.env`. Do not commit `.env`.

## Run

In separate terminals:

```bash
npm run dev:api
npm run dev:studio
```

The API does not load `.env` by magic yet. For the current skeleton either export the variables in your shell or start Node with an environment-file option during local validation. A shared CLI/config-loading experience is a planned task rather than something this document pretends already exists.

## Validate current code

After dependencies are installed:

```bash
npm test
npm run build --workspace=@yuncms/studio
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
