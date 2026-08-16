# Environment / Manual TODO

This file contains only work that cannot be completed or truthfully verified from the current GitHub-connector environment. Product roadmap work belongs in `plan.md`.

## Next Codex/local-machine session

- [ ] Clone/switch to branch `16-08-2026` and run `npm install` after the workspace/package files land. Commit the generated `package-lock.json` if dependency resolution succeeds without unexpected major-version drift.
- [ ] Confirm the local runtime is Node.js 24 LTS with `node --version`. Do not continue on an EOL Node release.
- [ ] Run all non-MySQL tests with `npm test` after dependencies are installed.
- [ ] Run Studio build with `npm run build --workspace=@yuncms/studio` (or the final workspace name if adjusted during implementation).
- [ ] Run API start/smoke check and verify `/health` returns process health without requiring a DB, while `/ready` reports DB readiness accurately.

## Real MySQL required

Use a disposable local MySQL 8 database; do not point early bootstrap/schema tests at production data.

- [ ] Create an empty database and a least-privilege test user able to create/alter/drop tables inside that database.
- [ ] Copy `.env.example` to `.env` and fill the MySQL connection values.
- [ ] Verify `mysql2/promise` can connect and `SELECT 1` succeeds.
- [ ] Once bootstrap code exists, run it twice against the same empty database and verify the second run is idempotent.
- [ ] Inspect created `yuncms_*` system tables manually after first bootstrap.
- [ ] Run real-MySQL integration tests for transactions, rollback, duplicate-key normalization, FK behavior, advisory schema locking, deadlock retry, and schema metadata/physical-schema consistency as those tests are added.

## npm/package publishing decisions

Do not publish from this environment.

- [ ] Confirm which npm scope/name YunCMS will own before public package names are considered stable (`yuncms`, `@yunsoft/*`, `@yuncms/*`, etc.). Internal workspace names may be renamed before first publish.
- [ ] Confirm npm authentication and organization permissions.
- [ ] Run `npm pack` for publishable packages and inspect package contents before any `npm publish`.
- [ ] Only after the CLI/bootstrap milestone is functional, test installation from a packed tarball in a brand-new directory so the setup flow is tested like a real user would install it.

## Manual security/production checks for later milestones

- [ ] Run auth/RBAC integration tests with separate admin, normal-role, and public identities against real MySQL.
- [ ] Test schema mutations concurrently from two processes, not only two promises in one process.
- [ ] Test graceful shutdown while requests and a DB transaction are active.
- [ ] Test local file storage permissions/path traversal once FilesService lands.
- [ ] Test S3-compatible storage against the actual provider intended for production once that driver lands.
