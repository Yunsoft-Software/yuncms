# YunCMS 0.1.6 release evidence

- Release date: 2026-08-23
- Branch: `22-08-2026`
- Tested release-candidate commit: `073890f`
- Published by npm account: `raichubuilds`

No GitHub Actions were used. All commands below ran locally against disposable MySQL databases and temporary local storage.

## Runtime and infrastructure

- Node.js `v24.18.1`
- npm `11.16.0`
- MySQL `8.4.11`
- Redis `8.10.1`
- disposable MySQL databases: `yuncms_test`, `yuncms_migration_test`, `yuncms_upgrade_test`, `yuncms_release_test`
- disposable Redis endpoint: `redis://127.0.0.1:6380`

`npm install --package-lock-only --ignore-scripts` and `npm ci --ignore-scripts` both completed with zero audit findings. The lockfile SHA-256 remained unchanged across `npm ci`:

```text
25b30502aaad521b37828928d718ba67b2e2458b4512dc3db20eee56b888dbbb
```

## Source, release and integration gates

- `npm run test:fast`: 71 files passed.
- `npm test`: 112 files passed.
- `npm run test:release`: 112 source files, Studio production build, all four package contracts and 9 real MySQL/API integration files passed.
- `npm run test:mcp:mysql`: the official MCP v2 client negotiated `2026-07-28`, observed server version `0.1.6`, and passed MySQL RBAC, host/origin/auth, result-limit, REST-equivalence and write-accountability coverage.
- `npm run test:redis:mysql`: two independent API processes passed shared permission-generation invalidation, filtered/unfiltered Public Files propagation, API/login rate-limit sharing and raw identity/token key-redaction checks.
- `npm run test:extensions:mysql`: real collection/field/M2O/O2O/M2M post-success event ordering passed; a forced MySQL metadata failure compensated its physical column and emitted no success event; two API processes ran one singleton job and honored the long-job SIGTERM budget.
- `npm run test:upgrade:mysql`: real maintenance locking, partial-DDL recovery, stopped-service backup, format-2 SHA-256 integrity, corrupted dump/asset pre-reset rejection, different-target refusal/override and exact destructive restore passed.
- The real MySQL/API flow accepted genuine PDF/PNG/JPEG/GIF/WebP signatures and rejected a spoofed PNG before metadata commit with HTTP 400 `FILE_MIME_MISMATCH`.

The Studio production build was also exercised in the in-app browser: administrator login, real JPEG upload, gallery rendering, image preview, reload/session continuity, deletion and sign-out passed.

## Local package smoke

All four final tarballs were packed and installed together into a clean directory. npm resolved only exact `0.1.6` internal packages, reported zero audit findings, and the CLI help contract passed. A disposable MySQL project then passed bootstrap, `/health`, `/ready`, bundled Studio delivery and clean SIGINT shutdown.

| Package | Registry SHA-1 |
| --- | --- |
| `@yunsoft/yuncms-core@0.1.6` | `0e1caae9659b99e251f12ba9bc363443762b0cf8` |
| `@yunsoft/yuncms-api@0.1.6` | `110500ca87502342c178f6217fd2deaf7f6a50fe` |
| `@yunsoft/yuncms-extensions-sdk@0.1.6` | `609f6ee83f68d6650f2c21a76229046be825f1dd` |
| `@yunsoft/yuncms@0.1.6` | `0cd079f8271bc302bd1c520dd253afe82859c345` |

Anonymous `npm view` checks matched every local tarball SHA-1 and SHA-512 integrity value. All four `latest` tags resolved to `0.1.6`; API depended on core `0.1.6`, and CLI depended on API/core `0.1.6` exactly.

## Clean registry install

A new directory with an empty npm configuration installed `@yunsoft/yuncms@0.1.6` from the public registry. The dependency tree contained CLI/API/core `0.1.6` only and reported zero audit findings.

The installed CLI then passed:

- interactive `yuncms init` against an empty disposable database;
- all 13 migrations and first-administrator creation;
- an idempotent follow-up `yuncms bootstrap` with schema version 3;
- `yuncms start` from the registry package;
- HTTP 200 for health, readiness, bundled Studio and administrator login;
- access/refresh token presence without logging either token;
- clean SIGINT shutdown.

The CLI publish initially returned npm HTTP 202 while registry processing completed. It did not appear in `npm stage list`; subsequent anonymous checks confirmed normal public publication and `latest=0.1.6`.

## Intentionally unverified deployment-specific gates

The remaining items in `todo.md` require real provider credentials or the intended deployment topology: external OIDC/OAuth2/LDAP/SAML tenants, a production reverse proxy/TLS path, Redis TLS/ACL, S3-compatible storage, SMTP, full media/branding browser scenarios and stopping every replica during a destructive multi-host maintenance window. None is claimed as verified by this release run.
