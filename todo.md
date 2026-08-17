# Environment / Manual TODO

Only checks that still require a real checkout, browser, MySQL instance or deployment provider belong here. Completed history is intentionally removed; source implementation status lives in `plan.md`.

## 1. Codex / Node 24 release checks

Run on branch `16-08-2026` from a fresh Node.js 24 checkout.

- [ ] Run `npm run test:fast`; fix only real failures. The fast gate now includes port-3008, accountability fields, timestamp presets, bounded system-resource permissions, delegated Users/Files/Roles guards, O2O, File/Image fields, localization, sidebar, dark-mode and Data Model field-builder regressions.
- [ ] Run `npm test`; confirm the complete auto-discovered core/API/CLI/extensions/Studio suite passes.
- [ ] Run `npm run test:release`; confirm source tests, Studio production build and all publishable `npm pack --dry-run` contracts pass.
- [ ] Inspect the production Studio build for unresolved translation keys or JSX/build errors introduced by the new Data Model field/accountability builder and system-resource permission matrix.

## 2. Fresh init / port 3008

- [ ] In a new empty project run `yuncms init`; inspect generated `.env` and confirm `PORT=3008`, `STUDIO_ORIGIN=http://localhost:3008` and `AUTH_PUBLIC_URL=http://localhost:3008`.
- [ ] Start that clean project without manually supplying a port and verify API + built Studio are served from the same listener on `http://localhost:3008`.
- [ ] Confirm fresh-install output/documentation never directs the operator to 8055 or Vite 5173.
- [ ] If an older local checkout still has an existing untracked `.env` with legacy ports, migrate that file manually; source defaults intentionally do not overwrite operator-owned existing environment files.

## 3. Migration 0007 / real MySQL accountability fields

Use a disposable MySQL 8-compatible database whose name clearly contains `test`, `ci` or `dev`.

- [ ] Upgrade a DB that currently has `0001`–`0006`; verify API startup refuses the incomplete DB until bootstrap applies `0007-system-permission-resources`, then starts normally.
- [ ] Run `YUNCMS_TEST_MYSQL=1 YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 npm run test:release`.
- [ ] Create a collection from Studio with the default four accountability options enabled and inspect MySQL: `created_at`, `updated_at`, `created_by`, `updated_by` must physically exist.
- [ ] Verify `created_at` defaults to `CURRENT_TIMESTAMP(3)` and `updated_at` has both `DEFAULT CURRENT_TIMESTAMP(3)` and `ON UPDATE CURRENT_TIMESTAMP(3)`.
- [ ] Verify `created_by` and `updated_by` are nullable FKs to `yuncms_users(id)` with `ON DELETE SET NULL`.
- [ ] Create a record as an authenticated user and verify all four accountability values are populated correctly; update it from another authenticated user and verify only the updated actor/time changes.
- [ ] Delete an actor user and confirm historical records remain while the corresponding actor FK becomes `NULL`.
- [ ] Attempt to PATCH or DELETE a system-managed accountability field through schema endpoints; verify the backend returns `SYSTEM_SCHEMA_READ_ONLY` and leaves the physical schema intact.
- [ ] Create a custom Timestamp field through Studio with “Current time” and “Update time automatically”; inspect its MySQL default/extra definition and verify metadata survives a supported later field-schema edit.

## 4. Default/system resource RBAC

- [ ] In Roles & Permissions verify the matrix contains normal project collections plus only the explicitly registered system resources: Users, Files and Roles.
- [ ] Verify internal tables such as permissions/sessions/tokens/audit are not exposed as delegatable matrix rows.
- [ ] Grant a custom role `Users: Read`; sign in as that role and verify user listing works while ungranted user actions fail.
- [ ] Grant selected Users create/update/delete actions and verify the delegated manager still cannot assign the Administrator role, change/delete an Administrator account or assign the Public role to a user.
- [ ] Grant Files read/create/update/delete selectively and verify each specialized `/files` action follows the corresponding permission.
- [ ] Grant `Roles: Read` and verify role labels/listing works; confirm create/update/delete stay protected and cannot be granted.
- [ ] Verify system-resource permissions stay action-only: no fake field/filter/validation editor should appear for Users/Files/Roles.
- [ ] Select the Public role and verify every system-resource action is visibly Protected; API permission creation for Public + system resource must fail.
- [ ] Attempt generic `/items/yuncms_users` or `/items/yuncms_files` access even with a delegated system permission; verify generic ItemsService refuses it and the specialized service remains the only execution path.

## 5. Data Model field / collection UX browser smoke

- [ ] New Collection: verify the accountability section is clear, all four recommended options are enabled by default, each can be independently disabled, and creation sends exactly the selected fields.
- [ ] Add Field: verify the grouped Common / Media / Advanced type browser is understandable and no longer feels like a raw database-type dropdown.
- [ ] Verify Short text, Long text, Integer, Decimal, Boolean, Date, Date & time, Timestamp, File, Image, Big integer, JSON and UUID each show sensible descriptions and only relevant configuration controls.
- [ ] Decimal: verify precision/decimal-place controls create the expected schema.
- [ ] Timestamp/Date & time: verify No default / Fixed value / Current time modes and automatic-update option behave as labelled.
- [ ] File/Image: verify the builder does not expose their UUID storage detail and Content still uses file/image pickers + previews.
- [ ] In an existing collection created with accountability fields, verify those rows are visibly marked System managed, are not offered as relation-source UUID fields and do not expose Delete/required mutation actions.
- [ ] Re-check Data Model field builder and collection-accountability UI on narrow screens and in both Light/Dark themes.
- [ ] Walk all new copy once in English and once in Turkish; no `fieldBuilder.*`, `collectionBuilder.*`, `roles.*` or `fieldType.*` keys may leak into UI.

## 6. Existing relation / file / Content smoke

- [ ] Create an optional UUID field, create an O2O relation from it, and inspect MySQL: the source field must have both the expected FK and one UNIQUE index while relation metadata reports `kind: "o2o"`.
- [ ] Insert one row using a target id, then try a second source row with the same target id; MySQL/API must reject the duplicate target link.
- [ ] Delete the O2O relation and verify the FK + UNIQUE index disappear while the underlying UUID field/data remain intact.
- [ ] Exercise O2O with `RESTRICT`, `CASCADE` and optional-field `SET NULL`; verify required fields reject `SET NULL`.
- [ ] Create/edit records with File and Image fields using both an existing library item and direct upload; verify reload/persistence and optional clear behavior.
- [ ] Verify rich authenticated previews: image thumbnail, embedded PDF, playable video, playable audio and clean unsupported-file placeholder.
- [ ] Re-run Content search/filter/sort/pagination after the accountability/timestamp changes; generated readonly fields must never become caller-editable payload inputs.

## 7. Sidebar / identity / branding / dark mode

- [ ] Verify Content, Library and Settings remain independent keyboard-operable accordion groups after the Data Model changes.
- [ ] Collapse the whole sidebar to the icon rail and expand it again; selected section/context must remain intact. Re-check narrow-screen behavior.
- [ ] Verify no “YunCMS Studio” copy is rendered beside the logo.
- [ ] Under the signed-in email verify the human-readable role name is shown and the raw role UUID never appears. Re-check after access-token refresh and full page reload.
- [ ] With default Yunsoft branding, verify Light/Dark/System themes select the intended approved logo asset; custom logos must remain unchanged while Yunsoft attribution stays visible.
- [ ] Visually inspect Login, Content, Files, Users, Data Model, field builder, accountability cards, Relations, Roles & Permissions, modal surfaces, Content Visibility and Appearance in both Light and Dark modes; there must be no accidental white legacy surfaces.
- [ ] Test visible keyboard focus, Escape/modal behavior, accordion controls, type cards, checkboxes and basic screen-reader labels.

## 8. Deployment-only hardening

- [ ] Behind the actual reverse proxy, configure exact `TRUST_PROXY_HOPS`; verify session IP and auth rate-limit buckets use the intended client IP. Confirm `TRUST_PROXY_HOPS=0` ignores forwarded addresses for direct deployments.
- [ ] Configure HSTS at the actual TLS/reverse-proxy layer and verify it there.
- [ ] If production uses S3-compatible storage, test the real provider: upload/list/download/delete, credential-chain behavior, reconciliation dry-run/age guard, multi-page inventory and redacted provider errors.

## 9. Final release decision

- [ ] Only after the applicable checks above pass, update the production-readiness decision for the actual deployment environment.
