# AGENTS.md

## Product direction
YunCMS is a small, reusable MySQL backend/CMS platform with a focused administration Studio. Keep the core understandable, stable and extensible; add features when they solve a real product need rather than for checklist parity with another product.

Public documentation on `main` is for installers, administrators, API consumers and extension authors. Internal implementation plans, temporary checklists and environment handoff notes belong in issues, pull requests or feature branches, not in root-level `plan.md` / `todo.md` files on `main`.

## Hard rules
- Use Node.js 24 LTS.
- Use JavaScript/ESM. Do not introduce TypeScript unless the owner explicitly asks for it.
- Backend HTTP layer is Express 5.
- Database support is MySQL only for V1.
- Database access is `mysql2/promise` directly. Do not add Knex, Prisma, Sequelize, an ORM, or a second database driver.
- REST only. Do not add GraphQL.
- Studio is React 19.2 + Vite 8.
- Use npm workspaces; do not add a monorepo build orchestrator without a demonstrated need.
- Do not use GitHub Actions.
- Keep commits small and focused. Do not mix unrelated refactors/features.
- Do not copy source code from other CMS products into YunCMS. Study public behavior or architecture only when useful, then implement YunCMS independently.
- Do not build speculative enterprise features. Prefer the smallest stable API that can be extended later.
- Every behavior change, bug fix, refactor that can regress behavior, schema change, UI interaction change, authorization change, configuration/default change, and documentation-visible runtime contract must receive corresponding regression coverage in the same development pass.
- Do not consider a change complete merely because source code was written. Its regression coverage and user-facing documentation must match shipped behavior.

## Architecture rules
- HTTP routes are thin. Business logic belongs in services.
- Internal code and extensions call services directly; they must never call YunCMS' own HTTP endpoints to perform local work.
- Authorization/accountability is explicit and is passed into services. `null` must never implicitly mean administrator.
- Public and system/internal access use explicit accountability helpers.
- SQL data values always use placeholders.
- Dynamic collection/field names must be resolved from trusted schema metadata and validated/quoted before becoming SQL identifiers.
- Schema mutations must be serialized and must keep physical MySQL schema and YunCMS metadata in sync.
- Dedicated services such as `UsersService` own special behavior (password/session rules); do not bypass them through raw generic CRUD for system data.
- Extensions are trusted server code in V1. Do not add a sandbox/marketplace until the core is stable.

## Developer ergonomics
Keep the public programming model consistent:
- service classes such as `ItemsService`, `CollectionsService`, `FieldsService`, `RelationsService`, `UsersService`, and `FilesService`;
- extension helpers such as `defineEndpoint()` and `defineHook()`;
- filter/action/init hook concepts;
- stable REST resource paths such as `/items`, `/schema`, `/files`, `/auth`, `/users`, `/roles`, and `/permissions`.

Do not add compatibility behavior merely to imitate another product. New behavior should have a clear YunCMS use case and a documented contract.

## Documentation discipline
- Keep `README.md` as the public entry point and documentation index.
- Keep detailed usage under `docs/` and write it for users/operators/integrators rather than as a development diary.
- Document only behavior implemented on `main`; avoid branch names, temporary status language, implementation plans, and stale release checklists in usage guides.
- Every public endpoint, query option, configuration variable, permission boundary, Studio workflow, CLI command, storage option and extension contract should be discoverable from the documentation index.
- When behavior changes, update the matching user guide in the same development pass.
- Internal plans and blocked-environment notes must not be added to `main` as `plan.md`, `todo.md`, roadmap documents, or release scratchpads.

## Testing
- Prefer Node's built-in test runner for backend/core unit tests unless a real need forces another framework.
- Every implementation change must have a directly relevant regression test where technically possible.
- Bug fixes must include a test that would have failed before the fix whenever practical.
- Configuration/default changes must include tests that lock the default and the generated/derived configuration contract.
- Authorization changes must include positive and negative boundary tests; UI permission changes must also verify that unavailable actions are not misleadingly exposed.
- Schema/DDL changes must include pure/source tests plus guarded real-MySQL coverage when physical constraints/defaults matter.
- Studio interaction changes should isolate pure logic for Node tests where possible, plus source-contract tests for React wiring.
- After normal source changes run `npm run test:fast` when the environment supports it.
- Before considering a larger source pass complete run `npm test`.
- Before a release candidate run `npm run test:release`.
- Real MySQL/API integration is opt-in inside the release runner. Use a disposable database whose name contains `test`, `ci` or `dev`, then set both `YUNCMS_TEST_MYSQL=1` and `YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1`.
- Test SQL-injection boundaries, authorization boundaries, transaction rollback, schema concurrency, session rotation/revocation, and extension accountability.
- Do not weaken tests to make them pass.
- Do not claim a test passed unless it was actually executed in the current environment or there is a concrete recorded result from the environment that ran it.

## Before every commit
1. Check the relevant runtime contract and existing documentation.
2. Check changed files and keep the scope focused.
3. Add or update regression coverage when behavior changed.
4. Run the narrowest relevant test available in the current environment.
5. Update user-facing documentation when the public contract changed.
6. Commit with a short descriptive message.
