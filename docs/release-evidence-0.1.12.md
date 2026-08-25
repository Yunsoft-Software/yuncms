# Release Evidence — 0.1.12

Date: 2026-08-25

## Git branches

- `main` release commit: `a0ed40b` (`release: version 0.1.12`)
- `24-08-2026` release commit: `5617292` (`release: version 0.1.12`)
- Product source and regression trees were compared across both branches after the merge.
- `main` retained the public installer/operator/integrator documentation set and contains no root `plan.md`, root `todo.md`, roadmap, testing, publishing or release-evidence documents.
- Pre-release branch tips remain reachable through the local `codex/pre-release-main-20260825` and `codex/pre-release-development-20260825` safety refs.

## Automated release gates

Executed with Node.js 24.19.0:

- `npm run test:release` passed on `main`.
- `npm run test:release` passed on `24-08-2026`.
- Complete source suite: 137 test files passed.
- Studio production build passed.
- Package dry-run contracts passed for core, API, CLI and extensions SDK.
- Real MySQL/API integration suite passed on new disposable `0.1.12` test databases, including schema/CRUD/auth/RBAC, migration replay, accountability, extension processes, MCP, one-to-one/File fields, deep relations and managed backup/restore/update.
- Isolated persistence-disabled Redis multiprocess integration passed for shared permission invalidation and API/auth rate-limit state.

The release gate initially found one stale integration assumption that treated migration `0013` as the last migration. The regression was corrected to apply `0013` and every later migration in order, verify one-time journaling and preserve pre-0013 auth data. The corrected real-MySQL test and the complete integration suite passed before publishing.

## npm publication

Published with npm 11.1.0 and public access:

- `@yunsoft/yuncms-core@0.1.12` — shasum `7ae5cdb41e91fa683023229ecc4ef4c3ce2b0056`
- `@yunsoft/yuncms-api@0.1.12` — shasum `8c55ba3e50178145cf520deca5e7913619ffaf5a`
- `@yunsoft/yuncms-extensions-sdk@0.1.12` — shasum `fdfff262aa8a75009d5576384d7b71670ccf7e50`
- `@yunsoft/yuncms@0.1.12` — shasum `668061844b02e0b7798acae1926a22d85c307a61`

Registry verification confirmed all four `latest` versions resolve to `0.1.12`. The CLI package pins both `@yunsoft/yuncms-api` and `@yunsoft/yuncms-core` to `0.1.12`; the API package pins core to `0.1.12`.

A clean registry install in a fresh temporary directory resolved CLI/API/core to `0.1.12`, and the installed `yuncms help` command completed successfully under Node.js 24.

## Remaining environment-specific checks

The pending SMTP delivery, real reverse-proxy, provider-specific S3 and manual browser/visual checks remain in `todo.md`. They were not represented as completed by this release evidence.
