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
- `todo.md` is only for work blocked by the current environment/manual credentials/infrastructure (for example real MySQL setup, `npm install`, npm publishing/auth, or tests that require unavailable services). Do not use `todo.md` as a second roadmap.
- Keep docs aligned with shipped behavior. Do not document unimplemented features as if they exist.

## Testing
- Prefer Node's built-in test runner for backend/core unit tests unless a real need forces another framework.
- Integration tests for schema/CRUD/auth/RBAC must run against real MySQL before those milestones are considered complete.
- Test SQL-injection boundaries, authorization boundaries, transaction rollback, schema concurrency, session rotation/revocation, and extension accountability.
- Do not weaken tests to make them pass.

## Before every commit
1. Re-read the relevant `plan.md` section.
2. Check `git diff`/changed files and keep scope focused.
3. Run the relevant local tests/checks available in the environment.
4. Update `plan.md` if the task is genuinely complete.
5. Add environment-only blockers to `todo.md` with exact commands/expected results where possible.
6. Commit with a short descriptive message.
