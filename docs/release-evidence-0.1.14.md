# Release Evidence — 0.1.14

Date: 2026-08-26

## Git branches

- `main` release commit: `7345460` (`release: version 0.1.14`).
- `24-08-2026` release commit: `a375add` (`release: version 0.1.14`).
- Both branches fast-forwarded the same nine upstream CLI/scaffold commits before release.
- The release trees match across application source, tests, `.env.example`, package manifests and package README files.
- A stale development copy of the public CLI configuration/README was aligned in `2fffd31`; `main` retained only the public user/operator/integrator documentation set.
- Both release branches were pushed atomically before npm publication.
- Pre-sync tips remain reachable through the local `codex/pre-sync-main-20260826` and `codex/pre-sync-development-20260826` safety refs.

## Release scope

The release adds the project scaffold created by `yuncms init`:

- project-local `uploads/` default and matching generated configuration;
- Plesk-compatible `start.js` using the packaged runtime entry;
- a 200-response example endpoint under `extensions/health/`;
- a minimal lifecycle hook under `extensions/example-hook/`;
- Windows `npm.cmd` / `npx.cmd` subprocess resolution.

Existing project files are preserved rather than overwritten.

## Automated release gates

Executed with Node.js 24.19.0 and npm 11.1.0:

- `npm run test:fast` passed on both branches: 71 files.
- `npm test` passed on both branches: 139 files.
- `npm run test:release` passed on both final `0.1.14` branch trees.
- Studio production builds passed.
- Package dry-run contracts passed for core, API, CLI and extensions SDK.
- The real MySQL/API integration suite passed on both final branch trees: 9 files covering schema/CRUD/auth/RBAC, migration replay, accountability, extension processes, MCP, one-to-one/File fields, deep relations, managed backup/restore/update and isolated Redis multiprocess behavior.
- A clean local-tarball installation resolved CLI/API/core to `0.1.14` and produced `uploads/`, `start.js`, the health endpoint and example hook from the packaged CLI.
- Disposable databases used names containing `test`; the existing manual YunCMS database was not targeted.

## npm publication

Published with public access in dependency order:

- `@yunsoft/yuncms-core@0.1.14` — shasum `8f26362a9b2afaabd53c2aaa5f65f8a079f42063`
- `@yunsoft/yuncms-api@0.1.14` — shasum `853d49aa540a470be2b17684802065c9adf7246d`
- `@yunsoft/yuncms-extensions-sdk@0.1.14` — shasum `dcd35011c2314b92469a7a726f15b2ed7267edc9`
- `@yunsoft/yuncms@0.1.14` — shasum `506df47904f6c3e237cbd2ad679e74e3fc7cf14e`

Anonymous registry verification confirmed all four `latest` tags resolve to `0.1.14`. The API package pins core to `0.1.14`; the CLI package pins API and core to `0.1.14`.

A clean public-registry installation resolved CLI/API/core to `0.1.14`, the installed `yuncms help` command completed successfully, and the installed scaffold generated every expected runtime/example file.

## Remaining environment-specific checks

The pending real SMTP/provider, production reverse-proxy/TLS, provider-specific S3 and authenticated manual browser/visual checks remain in `todo.md`. They were not represented as completed by this release evidence.
