# Package naming and publishing policy

This document records the final npm package family and release procedure. YunCMS is developed and maintained by [Yunsoft Software](https://yunsoft.com). The first public release, `0.1.0`, was published under the MIT License on 2026-08-17.

YunCMS remains under active development. Publishing a package does not make it a stability or production-readiness guarantee; consumers should test upgrades, keep verified backups and use the software at their own risk under the MIT License.

## Verified npm account and registry state

The release checks were run on 2026-08-17 while authenticated to npm as `raichubuilds`:

- authentication succeeds and the account has read-write access to its existing packages;
- the `yunsoft` npm organization was created on the free public-package plan;
- `raichubuilds` is the verified owner of the `@yunsoft` organization;
- all four public packages are owned through `@yunsoft` with read-write access;
- the earlier `@yuncms` scope was not created and is no longer the package direction.

Every `0.1.0` package was verified through unauthenticated `npm view` queries and a clean registry install. The temporary release tokens were revoked after publishing.

The `0.1.1` package family was published on 2026-08-17 after the Node 24 fast/full/release gates, real-MySQL integration, Studio browser smoke and package contract checks passed. All four exact versions and internal dependency pins were then verified through unauthenticated registry queries and a clean `@yunsoft/yuncms@0.1.1` install/CLI smoke.

The `0.1.5` package family was published on 2026-08-22 after Node 24 fast/release gates, real MySQL/API and managed-upgrade integration, local tarball installation, registry-only installation/runtime smoke and a published `0.1.3 -> 0.1.5` managed transition passed. All four registry SHASUM values and exact internal `0.1.5` dependency pins were verified anonymously. Version `0.1.4` was uploaded only to npm's staging area and was superseded before publication because staged approval required a separate interactive 2FA flow; it must not be treated as a public release.

The `0.1.6` package family was published on 2026-08-23 after Node 24 fast/full/release gates, all nine real MySQL/API integration files, two-process Redis and scheduler checks, Studio browser smoke, managed-backup corruption/target safeguards, final tarball installation and a clean public-registry init/bootstrap/start/login smoke passed. All four `latest` tags, registry SHASUM/integrity values and exact internal `0.1.6` dependency pins were verified anonymously. Detailed commands and remaining deployment-specific exclusions are recorded in [`release-evidence-0.1.6.md`](release-evidence-0.1.6.md).

The `0.1.7` package family was published on 2026-08-23 after a clean published `0.1.5 -> 0.1.6`, blocked managed downgrade, exact backup-based `0.1.6 -> 0.1.5` recovery, repeated `0.1.5 -> 0.1.6` upgrade and final published `0.1.6 -> 0.1.7` transition. It fixes false `SERVER_PRESSURE` responses caused by comparing live heap use with only the currently committed heap, and makes the manual restore dependency-reinstall requirement explicit. Node 24 full/release gates, all nine real integration files, local and registry package checks, MCP v2 negotiation and Studio browser checks passed. Detailed evidence is recorded in [`release-evidence-0.1.7.md`](release-evidence-0.1.7.md).

The `0.1.10` package family was published on 2026-08-24 with persisted administrator AI settings/write modes and the Directus-like Data Model folder, ordering, collapse and pointer drag/drop pass. Node 24 release gates, all nine real MySQL/API integration files, local tarball installation, live Studio interaction checks and a clean public-registry install passed. All four `latest` tags, registry SHA1/integrity values and exact internal `0.1.10` dependency pins were verified anonymously. Detailed evidence is recorded in [`release-evidence-0.1.10.md`](release-evidence-0.1.10.md).

## Naming direction

Keep the product and executable command simple:

```text
yuncms
```

The final public package family is:

```text
@yunsoft/yuncms                   # CLI / top-level package
@yunsoft/yuncms-core              # core services/runtime primitives
@yunsoft/yuncms-api               # Express API runtime
@yunsoft/yuncms-extensions-sdk    # extension authoring helpers
```

Studio remains an application artifact rather than a public library for the first release.
The executable bin remains `yuncms`, so a project that installs `@yunsoft/yuncms` runs the familiar `npx yuncms ...` commands.

## Installation

```bash
npm install @yunsoft/yuncms
npx yuncms init
npx yuncms start
```

For a global CLI installation:

```bash
npm install --global @yunsoft/yuncms
yuncms init
yuncms start
```

YunCMS requires Node.js 24 LTS and MySQL for V1. `yuncms init` writes project-local configuration, verifies the database, applies migrations and creates or reuses the first administrator.

## Publish order

Internal dependencies use exact same-release versions, so publish in dependency order:

1. `@yunsoft/yuncms-core`;
2. `@yunsoft/yuncms-api`;
3. `@yunsoft/yuncms-extensions-sdk`;
4. `@yunsoft/yuncms`.

Run `npm pack` and the fresh-directory install/start smoke against each final version before publishing. Scoped packages must use public access.

## Release guard

A package is not considered released merely because it appears in `package.json` or this document. For subsequent releases, repeat the final pack/install smoke, publish in dependency order, verify every exact version through unauthenticated `npm view` queries, and test `npx yuncms init`, `bootstrap` and `start` from a clean registry install.
