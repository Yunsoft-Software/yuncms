# Environment / Manual TODO

This file intentionally contains only checks that cannot be truthfully completed from the GitHub-connector environment. Source/product status belongs in `plan.md`; completed historical verification does not need to stay duplicated here.

## 1. Current branch verification

Run on branch `16-08-2026` with Node.js 24 LTS and installed dependencies.

- [ ] Run `npm run test:fast`; expect one concise success stage and detailed output only on failure.
- [ ] Run `npm test`; confirm the complete discovered core/API/CLI/extensions/Studio source suite passes, including localization and Studio settings tests.
- [ ] Run `npm run test:release`; confirm the full source suite, Studio production build and all publishable `npm pack --dry-run` contracts pass.
- [ ] Confirm a fresh production Studio build has no unresolved translation-key text such as `content.*`, `roles.*`, `files.*` or `dataModel.*` rendered to the user.

## 2. Migration / real MySQL

Use a disposable MySQL 8-compatible database only.

- [ ] Upgrade a DB that currently has migrations `0001`–`0005`; verify `yuncms start` refuses to listen until `yuncms bootstrap` applies `0006-studio-settings`.
- [ ] Verify `0006` creates exactly one `yuncms_studio_settings` row with YunCMS brand name, Yunsoft default logo, `#2563eb`, `system` theme and `en` locale; rerun bootstrap and confirm idempotency.
- [ ] Run `YUNCMS_TEST_MYSQL=1 YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 npm run test:release` against a disposable DB whose name contains `test`, `ci` or `dev`.
- [ ] Re-check Public role fail-closed behavior, filtered/field-limited Public reads and optional validation-limited Public creates.
- [ ] Re-check normal collection and M2M junction visibility toggles against real MySQL; schema/data must remain intact.

## 3. Branding / appearance / localization browser smoke

Run the built Studio against the disposable API/DB.

- [ ] Before login, verify the default Yunsoft logo is visible, the login/reset/verification screens can switch between English and Turkish, and the small Yunsoft copyright/powered-by footer is visible.
- [ ] In Settings → Branding & Appearance, set a custom brand name and custom logo URL; verify the custom logo completely replaces the Yunsoft logo everywhere, while the footer still shows the Yunsoft copyright/powered-by attribution.
- [ ] Verify a broken custom logo URL fails gracefully to brand text without restoring a second Yunsoft logo beside it.
- [ ] Reset branding and verify the official default Yunsoft logo returns.
- [ ] Change the accent color and verify primary actions, active navigation/focus treatment and related accents update without reducing readable contrast.
- [ ] Verify Light, Dark and System themes across login, Content, Files, Users, Data Model, Roles & Permissions, Content Visibility, modals and Branding & Appearance.
- [ ] With theme set to System, change the OS/browser color-scheme preference and verify Studio follows it without reload where supported.
- [ ] Change the server default language between `en` and `tr`; in a clean browser profile verify it controls the initial Studio language.
- [ ] Set a personal EN/TR language override, log out/in and reload; verify the browser preference persists and overrides the server default.
- [ ] Choose “Follow system default”; verify the personal override is removed and the server default language takes effect.
- [ ] Walk every primary workflow in both languages: auth, Content CRUD/filter/sort/pagination, Files, Users, Data Model M2O/M2M, Roles/Public permissions, Content Visibility, Branding & Appearance and confirmation dialogs.
- [ ] Re-check narrow-screen layout for the language switcher, custom logo, appearance form and Yunsoft footer.
- [ ] Perform a formal keyboard/focus/labels/screen-reader and light/dark contrast review.

## 4. Existing Studio data-workspace smoke

- [ ] Content: verify server-backed text search, multiple field filters, ascending/descending and header sort, page-size changes, pagination and accurate filtered `total_count` with more than one page.
- [ ] Content: rapidly change search/filter/sort controls and verify stale responses never replace the newest result set.
- [ ] Files: verify type filters and newest/oldest/name/size sort presets in Gallery and List; switching view must preserve controls.
- [ ] Users: verify collapsed New User flow, search, role/status filters, sorting and inline role/status updates.
- [ ] Data Model: verify collection/field search and sorting with many collections/fields.
- [ ] Roles & Permissions: verify role search/sort, collection search and Configured-only mode with mixed permission coverage.

## 5. Real deployment hardening

- [ ] Behind the actual reverse proxy, configure exact `TRUST_PROXY_HOPS`; verify session IP and auth rate-limit buckets use the intended client IP. Confirm `TRUST_PROXY_HOPS=0` ignores forwarded addresses for direct deployments.
- [ ] Send malformed JSON with a valid `X-Request-Id`; verify HTTP 400 `INVALID_PAYLOAD`, correlated request id and no parser/internal-message leakage.
- [ ] Verify unsafe or longer-than-64-character caller request ids are replaced with UUIDs.
- [ ] Configure HSTS at the real TLS/reverse-proxy layer and verify it there.
- [ ] Verify the production environment can reach `https://yunsoft.com/light-logo.png`; if production CSP/network policy blocks external images, explicitly host an approved logo URL and set it through Branding & Appearance.

## 6. Production storage provider

Use the actual S3-compatible provider intended for production.

- [ ] Configure bucket/region/endpoint/path-style/credentials and verify upload/list/download/delete.
- [ ] Verify credential-chain behavior when explicit keys are intentionally omitted.
- [ ] Run S3 reconciliation dry-run and age-guarded orphan cleanup.
- [ ] Exercise multi-page object inventory and continuation handling.
- [ ] Force provider errors and verify credentials/secrets never reach clients or logs.

## 7. Final release decision

- [ ] Only after the applicable checks above pass, update the production-readiness decision for the actual deployment environment.
