# Package naming and publishing policy

This document records the final npm package family and release procedure. The first public release, `0.1.0`, was published under the MIT license on 2026-08-17.

## Verified npm account and registry state

The release checks were run on 2026-08-17 while authenticated to npm as `raichubuilds`:

- authentication succeeds and the account has read-write access to its existing packages;
- the `yunsoft` npm organization was created on the free public-package plan;
- `raichubuilds` is the verified owner of the `@yunsoft` organization;
- all four public packages are owned through `@yunsoft` with read-write access;
- the earlier `@yuncms` scope was not created and is no longer the package direction.

Every `0.1.0` package was verified through unauthenticated `npm view` queries and a clean registry install. The temporary release tokens were revoked after publishing.

The `0.1.1` package family was published on 2026-08-17 after the Node 24 fast/full/release gates, real-MySQL integration, Studio browser smoke and package contract checks passed. All four exact versions and internal dependency pins were then verified through unauthenticated registry queries and a clean `@yunsoft/yuncms@0.1.1` install/CLI smoke.

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
