# Package naming and publishing policy

This document records the chosen naming direction. It does **not** claim that npm ownership/availability has already been verified.

## Naming direction

Keep the product and command name simple:

```text
yuncms
```

Preferred package family, matching the current workspace names:

```text
yuncms                  # CLI / top-level package
@yuncms/core             # core services/runtime primitives
@yuncms/api              # Express API runtime
@yuncms/extensions-sdk   # extension authoring helpers
```

Studio remains an application artifact rather than a public library for the first release.

If the `@yuncms` npm scope cannot be owned/used at publish time, use the Yunsoft-branded fallback without changing product terminology:

```text
@yunsoft/yuncms
@yunsoft/yuncms-core
@yunsoft/yuncms-api
@yunsoft/yuncms-extensions-sdk
```

The executable bin remains `yuncms` in either naming scheme.

## Why the repository is not renamed now

The current source already consistently imports `@yuncms/core`, `@yuncms/api` and `@yuncms/extensions-sdk`. Renaming every internal package before npm ownership is checked would create churn with no product benefit.

Therefore:

1. keep current workspace package names while developing;
2. verify npm scope/name ownership from a real authenticated npm environment;
3. run `npm pack` for every publishable package;
4. inspect tarball contents and dependency references;
5. install the tarballs in a brand-new directory;
6. run `yuncms init`, `bootstrap` and `start` from that fresh install;
7. only then remove `private` flags/set final versions and publish.

## Release guard

A package name is not considered final merely because it appears in `package.json` or this document. npm ownership/authentication and packed-install verification remain manual release gates in `todo.md`.
