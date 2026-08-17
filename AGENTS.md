# AGENTS.md

## Product direction
YunCMS is a small reusable backend platform inspired by the Directus features we actually use. It is an independent implementation, not a Directus fork. Keep the core smaller than Directus and add features only when a real project needs them.

The source of truth for roadmap/status is `plan.md`. Read it before coding.

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
- Do not copy Directus source code into YunCMS. Directus may be studied for architecture, extension ergonomics, behavior, and edge cases; write YunCMS' implementation independently.
- Do not build speculative enterprise features. Prefer the smallest stable API that can be extended later.
- Every behavior change, bug fix, refactor that can regress behavior, schema change, UI interaction change, authorization change, configuration/default change, and documentation-visible runtime contract must receive corresponding regression coverage in the same development pass.
- Do not consider a change complete merely because source code was written. Its test coverage and test-handoff state must also be updated.

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

## Directus-like developer ergonomics
Keep familiar concepts where useful:
- `ItemsService`, `CollectionsService`, `FieldsService`, `RelationsService`, `UsersService`, `FilesService`.
- Extension helpers such as `defineEndpoint()` and `defineHook()`.
- Hook concepts such as filter/action/init.
- REST paths such as `/items`, `/collections`, `/fields`, `/relations`, `/files`, `/auth`, `/users`, `/roles`.

Do not chase API compatibility for its own sake. If Directus behavior would add substantial complexity, document the deliberate difference.

## Documentation/status discipline
- `plan.md` is a live checklist, not a static proposal.
- When an implementation task is completed, mark the corresponding `plan.md` checkbox in the same commit when practical; otherwise update it in the immediate follow-up commit.
- Do not mark an item complete merely because a file/stub exists. The stated behavior must be implemented and, where feasible, tested.
- If implementation reveals a missing step or an invalid assumption, update `plan.md` before or with the code that depends on the new decision.
- `todo.md` is only for work blocked by the current environment/manual credentials/infrastructure (for example real MySQL setup, `npm install`, npm publishing/auth, browser checks, provider credentials, or test commands that cannot truthfully be run in the current environment). Do not use `todo.md` as a second roadmap.
- `todo.md` is a live **pending verification list**, not a completed-test history. Never keep `[x]` completed items there.
- When a source/test change makes a verification command or manual check necessary but it cannot be executed in the current environment, add that exact pending check to `todo.md` in the same development pass.
- When a pending test/check is actually executed successfully, remove its `todo.md` entry rather than marking it completed.
- Once a test/check has been successfully completed and removed from `todo.md`, do not add it back on later turns unless the covered source/test/contract changed in a way that makes the previous result stale, or the target environment materially changed.
- When test code itself changes, treat the affected test result as stale until rerun; if it cannot be rerun immediately, add the relevant command/check back to `todo.md`.
- Keep docs aligned with shipped behavior. Do not document unimplemented features as if they exist.

## Testing
- Prefer Node's built-in test runner for backend/core unit tests unless a real need forces another framework.
- Every implementation change must have a directly relevant regression test where technically possible. If a behavior can only be verified with real MySQL, browser interaction, S3, SMTP, packaging, or another unavailable runtime dependency, write the automatable portion first and put the remaining executable/manual verification in `todo.md`.
- Bug fixes must include a test that would have failed before the fix whenever practical.
- Configuration/default changes must include tests that lock the default and the generated/derived configuration contract.
- Authorization changes must include positive and negative boundary tests; UI permission changes must also verify that unavailable actions are not misleadingly exposed.
- Schema/DDL changes must include pure/source tests plus guarded real-MySQL coverage when physical constraints/defaults matter.
- Studio interaction changes should isolate pure logic for Node tests where possible, plus source-contract tests for React wiring; browser-only visual/interaction checks belong in `todo.md` until executed.
- After normal source changes run `npm run test:fast`. It is the default Codex feedback loop and intentionally prints only a short stage result unless something fails.
- Before considering a larger source pass complete run `npm test`; it discovers and runs the complete non-environment test suite.
- Before a release candidate run `npm run test:release`; it runs the complete suite, Studio production build and npm package dry-run checks.
- Real MySQL/API integration is opt-in inside the release runner. Use a disposable database whose name contains `test`, `ci` or `dev`, then set both `YUNCMS_TEST_MYSQL=1` and `YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1`.
- Do not run real MySQL/S3/SMTP/browser checks after every edit. Keep those environment-dependent checks for the relevant milestone/release gate so routine Codex work stays fast and low-noise.
- Integration tests for schema/CRUD/auth/RBAC must run against real MySQL before those milestones are considered production-verified.
- Test SQL-injection boundaries, authorization boundaries, transaction rollback, schema concurrency, session rotation/revocation, and extension accountability.
- Do not weaken tests to make them pass.
- Do not claim a test passed unless it was actually executed in the current environment or there is a concrete recorded result from the environment that ran it.

## Before every commit
1. Re-read the relevant `plan.md` section.
2. Check `git diff`/changed files and keep scope focused.
3. Add or update the regression test for the behavior being changed.
4. Run `npm run test:fast` or the narrower directly relevant test when the environment supports Node 24/dependencies.
5. If a required test/check cannot be run, add it to `todo.md`. If it ran successfully and its covered code/test has not changed since, remove the pending `todo.md` entry instead of marking it complete.
6. Update `plan.md` if the task is genuinely complete.
7. Commit with a short descriptive message.
