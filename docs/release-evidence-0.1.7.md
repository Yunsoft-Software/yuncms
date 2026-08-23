# YunCMS 0.1.7 release evidence

Date: 2026-08-23  
Branch: `22-08-2026`  
Runtime: Node.js `24.18.1`, MySQL `8.4.11`, Redis `8.10.1`

## Clean installation and version-cycle verification

A fresh public-registry project was installed from `@yunsoft/yuncms@0.1.5` against a disposable `yuncms_cycle_test` database. Interactive init applied migrations `0001` through `0012` and created the first administrator. The fixture then created two naturally named Turkish collections with stable API keys, four project fields, a direct M2O relation, two authors, two articles, Public row/field permissions, API tokens and a real 68-byte PNG.

The pre-upgrade baseline verified:

- administrator and API-token REST access returned both rows;
- Public access returned only the `published` row;
- direct relation expansion returned Ada Lovelace and Grace Hopper;
- the uploaded file SHA-256 was `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`;
- MCP was absent in `0.1.5`, as expected before the feature release.

The following real package/database transitions were then executed:

1. published `0.1.5 -> 0.1.6` dry-run and managed update, including verified backup, migration `0013-external-auth-foundation` and readiness probe;
2. published `0.1.6 -> 0.1.5` dry-run and real update refusal with both `UPDATE_MIGRATION_HISTORY_INCOMPATIBLE` and `UPDATE_DOWNGRADE_FORBIDDEN`, with package files, database, storage and backup count unchanged;
3. exact restore of the pre-upgrade backup, followed by `npm ci`, returning package/lock/node_modules, 12 migrations, display metadata, rows, permissions, tokens and file bytes to the `0.1.5` snapshot;
4. a second published `0.1.5 -> 0.1.6` managed update and readiness probe;
5. published `0.1.6 -> 0.1.7` dry-run and managed update, including a verified backup and readiness probe.
6. published `0.1.7 -> 0.1.6` dry-run and real update refusal with `UPDATE_DOWNGRADE_FORBIDDEN`; package/lock/node_modules, environment and file hash remained unchanged before the final `0.1.7` restart.

The final project has exact `0.1.7` pins in `package.json` and `package-lock.json`, installed CLI/API/core `0.1.7`, 13 migrations, two articles, two authors, one file and the original Public permissions.

## Defects found and fixed

The published `0.1.6` runtime intermittently returned `503 SERVER_PRESSURE` after ordinary sequential requests and also rejected a real Studio login. The limiter divided `heapUsed` by V8's currently committed `heapTotal`, which can temporarily approach 100% while V8 still has ample capacity to grow. `0.1.7` compares usage with V8's real `heap_size_limit` instead. A regression test locks this behavior while preserving the configured heap and concurrent-request shedding boundaries.

The version-cycle test also proved that manual restore correctly restores package metadata but intentionally does not mutate `node_modules`. Starting before `npm ci` failed closed with `DATABASE_MIGRATION_REQUIRED`. The CLI now prints the exact `npm ci`/`npm install` follow-up after restore, with regression coverage and aligned upgrade/setup documentation.

## Automated release gates

Executed under Node.js 24.18.1:

- focused pressure and restore regression tests: 8 passed;
- `npm run test:fast`: 71 test files passed;
- `npm test`: complete 112-file source suite passed;
- `npm run test:mcp:mysql`: official MCP v2 client integration passed after the `0.1.7` server-version contract was aligned;
- `npm run test:release`: complete 112-file source suite, Studio production build, four npm package contracts and all nine real MySQL/API integration files passed.

The real release runner used separate disposable release, migration, upgrade and restore databases plus a temporary Redis server. It covered the real API flow, query/RBAC depth, external-auth migration, MCP v2, two-process Redis state, extension/scheduler processes and managed backup/restore safeguards.

Four final local tarballs installed together into a clean directory with zero audit findings. Their packaged sources were inspected to confirm the heap-limit fix and restore reminder were included. The packaged runtime then served 133 successful HTTP requests, negotiated MCP `2026-07-28`, advertised server version `0.1.7`, exposed seven read/write tools, returned both relation-expanded rows and preserved the file hash.

## Published registry verification

All four packages were published publicly and verified anonymously with `latest=0.1.7` and exact internal dependency pins:

- `@yunsoft/yuncms-core@0.1.7` — SHA1 `c7ac5f27da85acb1abc0c5b31dee8b201c2066e3`;
- `@yunsoft/yuncms-api@0.1.7` — SHA1 `b43ad5723ac2534c813ec43ea0db743c24ed0ff1`;
- `@yunsoft/yuncms-extensions-sdk@0.1.7` — SHA1 `2a3ec9a48f877abd476b47fc13ab73e0502814b9`;
- `@yunsoft/yuncms@0.1.7` — SHA1 `cf9f76c7246d4c1a4110cbc31d1bca328a1f1816`.

The published `0.1.7` runtime completed a 135-request HTTP/API pass without `SERVER_PRESSURE`, negotiated MCP `2026-07-28` as `yuncms 0.1.7`, exposed all seven tools, enforced Host and Origin guards, returned both administrator rows and only one Public row, expanded both authors and reproduced the original file SHA-256.

The built Studio was exercised through a real browser against the published runtime. Turkish login succeeded, the sidebar showed both collections, the content grid showed both relation-expanded records, API status was online, and the preserved PNG opened in the authenticated preview dialog.

After the final downgrade refusal, the published test installation was restarted on `127.0.0.1:3018`; `/health` returned 200 and `/ready` returned 200 with ready status.

## Remaining deployment-specific exclusions

Real third-party OIDC/OAuth2/LDAP/SAML tenants, production reverse proxy/TLS behavior, Redis TLS/ACL, S3-compatible storage, SMTP delivery and multi-host maintenance-window coordination still require their target infrastructure and credentials. They remain pending in `todo.md`; this release does not claim those provider-specific checks.
