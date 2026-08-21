# Environment / Manual TODO

Only checks that still require a real Node 24 checkout, browser, MySQL instance or deployment provider belong here. This is a **pending verification list**: when a check passes it is removed, not kept as `[x]` history. If its covered source changes later, it becomes pending again.

## 1. Node 24 source gates

Run from a fresh checkout of the final `21-08-2026` state.

- [ ] Run `npm run test:fast`; fix only real failures. The fast suite now includes migrations through `0010`, schema human-name normalization, Directus-style `fields=*` / `fields=*.*` / nested direct-relation selection, legacy expand compatibility, Public Files grant boundaries, file-backed logo/favicon, modal asset picker, full Files preview, dark permission badges, Data Model V2, bounded system fields, O2O/File/Image/accountability/auth/RBAC and EN/TR regressions.
- [ ] Run `npm test`; confirm the complete auto-discovered core/API/CLI/extensions/Studio suite passes.
- [ ] Run `npm run test:release`; confirm complete tests, Studio production build and every `npm pack --dry-run` contract pass.
- [ ] Confirm Studio production build has no JSX/import errors or unresolved translation keys after the Public permission-matrix behavior change and the existing `BrandAssetPicker`, `FilePickerModal`, `FilePreviewModal`, `schema-name`, locale modules and Data Model label/key changes.

## 2. Directus-style fields / relation query smoke

- [ ] Create a direct M2O relation such as `articles.author_id -> authors.id` and verify `GET /items/articles?fields=*` returns all readable source fields without expanding `author_id`.
- [ ] Verify `GET /items/articles?fields=*.*` returns all readable source fields and expands every readable direct to-one relation exactly one level.
- [ ] Verify `GET /items/articles?fields=id,title,author_id.*` returns the selected source fields plus all readable author fields.
- [ ] Verify `GET /items/articles?fields=id,author_id.name` returns only `name` inside the expanded author object while still using the target key internally for lookup.
- [ ] Verify source and target field allowlists plus target row filters still apply to `*.*`, `relation.*` and `relation.field` and cannot be widened by wildcards.
- [ ] Verify legacy `expand=author_id` still works and no longer rejects a request merely because more than eight direct relations were requested.
- [ ] Verify deeper paths and junction/M2M expansion fail closed with the documented unsupported-relation error until those capabilities are implemented.

## 3. Public Files permission smoke

- [ ] With no Public `yuncms_files:read` permission, anonymous Files list/read/content requests must remain forbidden and must not query file metadata/content after permission denial.
- [ ] In Studio select the Public role and grant Files `read`; the control must be configurable instead of disabled.
- [ ] After that explicit grant, anonymous Files list/read/content must work through the normal Public accountability + permission engine so a public image gallery can consume them.
- [ ] Remove the grant and confirm anonymous Files access immediately returns to deny-by-default behavior.
- [ ] Verify non-permission-managed system collections remain non-delegatable and actions outside a permission-managed resource's `allowedActions` remain protected for Public and custom roles.
- [ ] Review intentionally public deployments before granting action-only system-resource access; Public system grants expose the specialized action as documented and do not support per-field/per-row narrowing in the current action-only mode.

## 4. Fresh install / port 3008

- [ ] In a new empty project run `yuncms init`; generated `.env` must contain `PORT=3008`, `STUDIO_ORIGIN=http://localhost:3008`, `AUTH_PUBLIC_URL=http://localhost:3008`.
- [ ] Start without manually setting a port and verify API + built Studio are served from `http://localhost:3008`.
- [ ] Confirm fresh-install output/docs do not direct users to legacy 8055 or Vite 5173.
- [ ] Migrate any existing operator-owned `.env` that still explicitly uses a legacy port; source intentionally does not overwrite it.

## 5. Real MySQL migration upgrade

Use a disposable MySQL 8-compatible database whose name contains `test`, `ci` or `dev`.

- [ ] Upgrade a DB applied through `0008`; bootstrap must apply `0009-schema-display-names` and `0010-studio-favicon-file` exactly once, then compatibility must pass.
- [ ] Verify `0009` backfills `yuncms_collections.name = collection` and `yuncms_fields.name = field` for legacy rows before making the columns NOT NULL.
- [ ] Verify `logo_file` and `favicon_file` are nullable indexed `CHAR(36)` FKs to `yuncms_files(id)` with `ON DELETE SET NULL`.
- [ ] Run `YUNCMS_TEST_MYSQL=1 YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 npm run test:release` against the disposable DB.

## 6. Human collection / field names

- [ ] In Studio create `Müşteri Talepleri`; verify the suggested machine key is `musteri_talepleri`, the display label remains exactly `Müşteri Talepleri`, and the physical/API collection key is normalized.
- [ ] Create fields such as `Ürün Fiyatı`, `İçecek Ölçüsü`, `Çalışma Şekli / Gün`; verify Turkish characters/spaces remain in labels while API keys normalize deterministically.
- [ ] Create a leading-number label such as `2026 Ürünleri`; verify a safe prefixed machine key is generated.
- [ ] Change an existing collection/field **display name** after data exists; verify the MySQL table/column and REST integration key do not rename.
- [ ] Verify sidebar, Data Model lists and relation selectors show the human label while technical key remains secondary/available.
- [ ] Exercise the same naming behavior through raw Schema REST requests so server-side normalization is proven independently from Studio.

## 7. Files preview regression

- [ ] In Files Gallery open a large portrait, landscape and transparent image; card preview must use `contain` instead of cropping and the Preview action must open the entire asset in the large modal.
- [ ] Open a PDF in the large modal and verify it remains usable at normal desktop height.
- [ ] Open video and audio files; native controls and authenticated blob loading must work.
- [ ] Verify unsupported files show a clean placeholder rather than a broken media element.
- [ ] Repeat in List view and confirm preview action opens the same full preview surface.
- [ ] Test file preview after an access-token refresh to ensure authenticated `apiBlob` behavior still succeeds.

## 8. Dark-mode regression from supplied screenshots

- [ ] Content pagination footer must stay dark; no white strip.
- [ ] Files Gallery/List result and pagination surfaces must stay dark.
- [ ] Roles & Permissions search/header/sticky first column/body/footer must stay dark.
- [ ] Specifically verify the `permission rules` count badge / role summary stat is readable and not white in Dark mode.
- [ ] Check hover/focus/active states for permission cells, badges and pagination in both themes.
- [ ] Smoke Content, Files, Users, Data Model, Roles and Branding once in Light and once in Dark for any remaining hard-coded light surface.

## 9. Logo / favicon Files modal

- [ ] Branding & Appearance must show compact Logo and Favicon asset summaries, not an inline dump of the full Files library.
- [ ] Clicking **Select from Files** must open a modal that lists only images, supports search and renders 12 items per page.
- [ ] Seed at least 100 images and verify the settings page remains compact and the modal paginates rather than rendering all 100 candidates at once.
- [ ] Select a logo, save, sign out/reload login and verify `/studio-settings/logo` renders that exact image before authentication.
- [ ] Select a favicon, save and verify the browser tab switches to `/studio-settings/favicon` without a full application restart.
- [ ] With no custom favicon, verify the initial HTML uses the Yunsoft `light-icon.png` default.
- [ ] Delete selected logo/favicon Files and verify their FKs become `NULL` and Studio returns to default assets.
- [ ] Confirm non-image Files and arbitrary external logo URLs are rejected by the service even through raw API requests.
- [ ] In separate-origin development with `VITE_API_URL`, verify custom logo/favicon assets are fetched from the API origin rather than the Vite origin.
- [ ] Verify public logo/favicon responses use `no-cache, must-revalidate` and CSP `sandbox` while arbitrary Files remain protected unless Public Files read was explicitly granted.

## 10. Data Model / navigation browser smoke

- [ ] Verify project/system collection list remains simple, searchable and free of unnecessary pagination/sort widgets.
- [ ] Selecting a collection opens `Overview / Fields / Relations` in one workspace.
- [ ] New collection flow exposes Display name, API key, description, Content visibility, searchable icon and recommended accountability fields in understandable order.
- [ ] Overview can change human display name, description, visibility, icon and sidebar order without changing collection key.
- [ ] Fields tab shows human field labels with machine keys secondary and can add fields through the grouped builder.
- [ ] Relations tab creates/deletes M2O, O2O and M2M and shows human labels in selectors while submitting machine identifiers.
- [ ] Hide/show a collection and verify Content sidebar updates without schema/data deletion.
- [ ] Reorder collections by drag-and-drop and move buttons; order must persist after reload. Drag must remain disabled while collection search is filtering the list.
- [ ] Walk Data Model in EN/TR and ensure no raw localization keys leak.

## 11. System collection extension fields

- [ ] As schema manager, add naturally named optional custom fields to `yuncms_users`, `yuncms_files`, `yuncms_roles`; verify normalized key + human name + physical column + `systemExtension: true` metadata.
- [ ] System field builder must not expose Required for these additions; raw `required:true` must fail `SYSTEM_EXTENSION_REQUIRED_UNSUPPORTED` before DDL.
- [ ] Internal sessions/tokens/permissions/audit system collections must reject the bounded endpoint with `SYSTEM_SCHEMA_READ_ONLY`.
- [ ] Non-schema-manager must fail authorization before DDL.
- [ ] Force a metadata failure in disposable DB and verify compensation removes the added physical column.
- [ ] Native system fields must remain protected.
- [ ] Current V1 boundary remains: specialized Users/Files/Roles screens do not yet generically edit values of newly added extension columns.

## 12. Existing data / relation regression

- [ ] Create a project collection with `created_at`, `updated_at`, `created_by`, `updated_by`; verify physical defaults/FKs and actor stamping.
- [ ] Create timestamp/date-time fields with fixed/current-time/auto-update behavior and verify MySQL definitions.
- [ ] Create File/Image fields and verify picker/upload/full preview persistence.
- [ ] Create O2O, confirm duplicate-target rejection, then delete it and verify FK/UNIQUE cleanup.
- [ ] Re-run Content search/filter/sort/pagination after name/metadata changes.
- [ ] Re-check management-created Users remain immediately verified and can sign in without an email verification wait.

## 13. Documentation smoke

- [ ] Follow README quick start in a clean checkout and confirm commands/URLs match reality.
- [ ] Run representative examples from `docs/api-query-language.md`: `fields=*`, `fields=*.*`, `relation.*`, `relation.field`, nested AND/OR filter, IN, NULL, text contains, multi-sort, pagination and legacy direct expand.
- [ ] Run the Public Files example from `docs/api-query-language.md` / `docs/permissions.md`: deny before grant, allow after explicit read grant, deny again after removal.
- [ ] Run representative schema examples from `docs/rest-api.md`, including natural display names and stable API keys.

## 14. Deployment-only hardening

- [ ] Behind the actual reverse proxy configure exact `TRUST_PROXY_HOPS` and verify client IP/rate-limit behavior.
- [ ] Configure/verify HSTS at the real TLS/reverse-proxy layer.
- [ ] If production uses S3-compatible storage, verify upload/list/download/delete, full previews, branding logo/favicon reads, reconciliation and redacted provider errors against the actual provider.

## 15. Final release decision

- [ ] Only after applicable checks above are removed as successfully completed should this exact source state be called deployment-verified production ready.
