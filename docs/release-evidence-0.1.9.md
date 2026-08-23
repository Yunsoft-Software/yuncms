# YunCMS 0.1.9 release evidence

Date: 2026-08-23

Branches: `22-08-2026`, `main`

Runtime: Node.js `24.18.1`, MySQL `8.4.11`

## Release scope

`0.1.9` replaces dense Studio tab/modal flows with routed collection, field, relation, permission, Files and Users pages. The mobile pass adds a labeled menu, route scroll restoration control, compact filters, card-based Content and Users lists, a direct field-type selector and responsive layouts for all list/detail/create surfaces. Numeric MySQL boolean values can no longer leak a visible `0` into the role page.

## Automated release gates

The final `npm run test:release` execution passed under Node.js `24.18.1`:

- complete 115-file source suite;
- Studio production build;
- package contracts for Core, API, CLI and Extensions SDK;
- all nine real MySQL/API integration files.

The integration runner used the disposable `yuncms_019_release_test` database on local MySQL. The database was dropped after the successful run.

## Browser and responsive verification

The running Studio was exercised against the populated manual test API at both 390 px and 320 px widths. The final 390 px set covers 22 list/detail/create routes across Content, Data Model, fields, relations, Roles/Permissions, Files, Users and Appearance. Critical Content, field, relation, permission, Files, Users and Appearance screens plus the open navigation were repeated at 320 px.

Live interactions covered mobile menu open/close, filter disclosure, record-detail navigation, direct field-type selection and routed scroll reset. Representative desktop Content, Data Model and role pages were also checked after the mobile stylesheet was applied.

## Published registry verification

All four public packages were published with the `latest` tag and the registry reports `0.1.9`:

- `@yunsoft/yuncms-core@0.1.9` — SHA1 `2c32066fc06ccbdf76b4eb9c4f9098098a6235ce`;
- `@yunsoft/yuncms-api@0.1.9` — SHA1 `423267d525eaa1acc104943e402133d2577ef678`;
- `@yunsoft/yuncms-extensions-sdk@0.1.9` — SHA1 `ea994232a47298467510d87b31779e0fa40e6cbb`;
- `@yunsoft/yuncms@0.1.9` — SHA1 `e27aa8801d9e1e2898465ae1b3e19bb1339c0121`.

A clean public-registry project installed exact `@yunsoft/yuncms@0.1.9` and `@yunsoft/yuncms-extensions-sdk@0.1.9` pins. `npm ls` resolved CLI, API, Core and SDK to `0.1.9`; the CLI help command executed successfully; the API package contained the built Studio assets; and `npm audit --omit=dev` reported zero vulnerabilities.

## GitHub publication

Release commit `b2f202d` was pushed to both `22-08-2026` and `main` before npm publication. This evidence file is the immediate post-publication follow-up commit.
