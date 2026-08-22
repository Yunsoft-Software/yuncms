# YunCMS 0.1.5 release evidence

Date: 2026-08-22

Branch: `22-08-2026`

Published source commit: `120c540`

This note records the completed `0.1.5` publication and local disposable-environment checks without credentials or secret configuration values. It does not replace the deployment/provider gates that remain in `todo.md`.

## Publication

The public package family was published in dependency order:

| Package | Registry SHASUM |
| --- | --- |
| `@yunsoft/yuncms-core@0.1.5` | `78d788076965f6156d383033ee56e7d8a012de61` |
| `@yunsoft/yuncms-api@0.1.5` | `ea051769ebe6a2e8de2fc14c921dde642ab452ed` |
| `@yunsoft/yuncms-extensions-sdk@0.1.5` | `1b170454cfec5a3b5016a0b4c3445f498939eaa1` |
| `@yunsoft/yuncms@0.1.5` | `ba29c1411eef0222345f500526b03fa347e1fcfd` |

Anonymous registry queries confirmed all four exact versions, tarball integrity fields and the API/CLI exact internal `0.1.5` dependency pins. The public `latest` tag for `@yunsoft/yuncms` resolved to `0.1.5`.

A granular npm token was restricted to read/write access for only these four packages, with no organization-management permission. npm allowed a maximum 90-day write-token lifetime. Its value is stored only in the ignored `.credentials/npmrc`; the directory/file modes were verified as `0700`/`0600`, and the value was not committed or copied into this evidence.

## Release and registry checks

- Node.js `24.18.1` and npm `11.16.0` were used.
- `npm ci` reported 0 vulnerabilities.
- `npm run test:fast` passed 71 files.
- `npm run test:release` passed 93 source files, the Studio production build and all four package contracts.
- The release runner passed four real MySQL/API integration files against `yuncms_test`.
- The dedicated managed-upgrade suite repeatedly passed its three cross-client lock, partial-DDL recovery and real mysqldump/restore tests against `yuncms_upgrade_test`; an independent final query confirmed zero tables remained after cleanup.
- A clean anonymous registry project installed exact `@yunsoft/yuncms@0.1.5`, reported 0 vulnerabilities and exposed the complete CLI help surface.
- The published package completed fresh `init`, created the first disposable administrator, wrote a protected port-3008 environment, bootstrapped migrations through `0012`, started successfully, passed `/health` and `/ready`, and shut down cleanly.
- Published-target `update --dry-run --to 0.1.5` loaded the target migration contract and reported the package/database already current without mutation.
- A published downgrade dry-run from `0.1.5` to `0.1.3` reported `UPDATE_DOWNGRADE_FORBIDDEN` without package mutation.
- Projects with a missing dependency, missing installed package or invalid installed semantic version failed before mutation with their documented errors.
- An injected unknown applied migration produced `UPDATE_MIGRATION_HISTORY_INCOMPATIBLE` without package mutation.

## Published managed transition

A clean registry project installed public `@yunsoft/yuncms@0.1.3`, bootstrapped its migration set through `0010`, then ran the first-transition form:

```text
npx --yes @yunsoft/yuncms@0.1.5 update --to 0.1.5
```

The command created and verified the mandatory backup before package mutation, installed exact `0.1.5`, applied `0011-role-permission-actions` and `0012-files-read-filters`, bootstrapped through the newly installed CLI, reached `/ready`, stopped the temporary runtime and left the project dependency/installed version at exact `0.1.5`.

The same published transition was repeated for projects declaring YunCMS in `devDependencies` and `optionalDependencies`; both retained their original dependency section.

## Remaining environment gates

The superseded `0.1.4` npm stage records still require cleanup. Published prerelease precedence, an installed-extension transition, forced automatic rollback failures, real supervisor races/handoff, production MySQL 8/TLS/scale and S3-provider recovery remain pending in `todo.md`.
