# Release Evidence — 0.1.13

Date: 2026-08-25

## Git branches

- `main` release commit: `0aa5056` (`release: version 0.1.13`).
- `24-08-2026` release commit: `619f766` (`release: version 0.1.13`).
- GitHub updates were fetched before release. The four compact Content/pagination commits were fast-forwarded into development and integrated into `main` without overwriting either branch.
- Both branches were pushed atomically before npm publication.
- Application source, tests and package manifests match across both branches. `main` retains only the public user/operator/integrator documentation set; development-only plans, test notes, publishing notes and release evidence remain on `24-08-2026`.
- Pre-sync tips remain reachable through the local `codex/pre-sync-main-20260825-2` and `codex/pre-sync-development-20260825-2` safety refs.

## Automated release gates

Executed with Node.js 24.19.0 and npm 11.1.0:

- `npm run test:fast` passed on both branches: 71 files.
- `npm test` passed on both branches: 138 files.
- `npm run test:release` passed on both final `0.1.13` branch trees.
- Studio production builds passed.
- Package dry-run contracts passed for core, API, CLI and extensions SDK.
- The real MySQL/API integration suite passed on both final branch trees: 9 files covering schema/CRUD/auth/RBAC, migration replay, accountability, extension processes, MCP, one-to-one/File fields, deep relations, managed backup/restore/update and isolated Redis multiprocess behavior.
- Disposable databases were isolated under names containing `test`; the existing manual YunCMS database was not targeted.

## npm publication

Published with public access in dependency order:

- `@yunsoft/yuncms-core@0.1.13` — shasum `7bc436aa737bc80e792e9e61ac37731aa675f563`
- `@yunsoft/yuncms-api@0.1.13` — shasum `4a4fe4354850f6daf3af4af30c1ac119857dd908`
- `@yunsoft/yuncms-extensions-sdk@0.1.13` — shasum `f539ba0be27f7c239c952c97d599ddc759216708`
- `@yunsoft/yuncms@0.1.13` — shasum `a0df823dbc984a5a5330c973fb97123b6fe99a93`

Anonymous registry verification confirmed all four `latest` tags resolve to `0.1.13`. The API package pins core to `0.1.13`; the CLI package pins API and core to `0.1.13`.

A clean temporary registry installation resolved CLI/API/core to `0.1.13`, and the installed `yuncms help` command completed successfully under Node.js 24.

## Remaining environment-specific checks

The pending real SMTP/provider, production reverse-proxy/TLS, provider-specific S3 and authenticated manual browser/visual checks remain in `todo.md`. They were not represented as completed by this release evidence.
