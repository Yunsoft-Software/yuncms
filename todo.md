# Environment / Manual TODO

Only checks that still require a real checkout, browser, MySQL instance or deployment provider belong here. This file is a **pending verification list**: completed checks are removed, never kept as `[x]` history. If covered source/test code changes after a successful run, the affected check becomes stale and is re-added.

## 1. Node 24 source gates

Run on branch `16-08-2026` from a fresh Node.js 24 checkout.

- [ ] Run `npm run test:fast`. The fast suite now includes the latest migration `0008`, file-backed branding, dark pagination/permission surfaces, simplified sidebar, collection icon/order metadata, Data Model V2, bounded system-collection field additions, existing auth/RBAC/O2O/File/Image/accountability regressions and EN/TR coverage.
- [ ] Run `npm test`; confirm the complete auto-discovered core/API/CLI/extensions/Studio source suite passes.
- [ ] Run `npm run test:release`; confirm complete tests, Studio production build and every publishable `npm pack --dry-run` contract pass.
- [ ] Confirm the Studio production build has no JSX/import errors or unresolved translation keys after `DataModelV2Screen`, `CollectionIconPicker`, `LogoFilePicker`, new CSS modules and system-schema route additions.

## 2. Fresh install / port 3008

- [ ] In a brand-new empty project run `yuncms init`; confirm generated `.env` contains `PORT=3008`, `STUDIO_ORIGIN=http://localhost:3008`, `AUTH_PUBLIC_URL=http://localhost:3008`.
- [ ] Start without manually supplying a port and verify API + built Studio are both served from `http://localhost:3008`.
- [ ] Confirm fresh-install output/docs do not direct a user to legacy 8055 or Vite 5173.
- [ ] Existing operator-owned `.env` files with legacy ports must be migrated manually; source intentionally does not overwrite them.

## 3. Real MySQL migrations / branding file

Use a disposable MySQL 8-compatible database whose name contains `test`, `ci` or `dev`.

- [ ] Upgrade a DB that has `0001`–`0007`; bootstrap must apply `0008-studio-logo-file` exactly once and compatibility must then pass.
- [ ] Inspect `yuncms_studio_settings.logo_file`: nullable `CHAR(36)`, indexed, FK to `yuncms_files(id)`, `ON DELETE SET NULL`.
- [ ] Run `YUNCMS_TEST_MYSQL=1 YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 npm run test:release`.
- [ ] From Branding & Appearance select an existing image from Files, save, sign out/reload the login surface and verify `/studio-settings/logo` renders that exact image before authentication.
- [ ] Delete the selected logo File and verify `logo_file` becomes `NULL` without deleting/corrupting Studio settings; default Yunsoft branding should render again.
- [ ] Confirm non-image Files cannot be stored as `logo_file` and arbitrary external logo URL updates are rejected.

## 4. Dark-mode visual regression from supplied screenshots

Verify the exact problem areas shown in the 2026-08-17 browser screenshots.

- [ ] Content table pagination footer in Dark mode must use dark Studio surfaces; no white pagination strip.
- [ ] Files Gallery/List pagination footer and gallery result surface must remain dark.
- [ ] Roles & Permissions matrix search/header/sticky first column/body/footer must remain dark; no white collection column or white toolbar/footer.
- [ ] Hover/active/focus states on permission cells and pagination controls must stay readable in Light and Dark themes.
- [ ] Review Content, Files, Users, Data Model, Roles and Branding screens once in both themes for any remaining hard-coded light surface.

## 5. Branding / theme behavior

- [ ] With default branding, set Dark theme and verify Yunsoft **light artwork** (`light-logo.png`) is used on the dark surface.
- [ ] Set Light theme and verify Yunsoft **dark artwork** (`dark-logo.png`) is used on the light surface.
- [ ] Set System theme and switch OS/browser color scheme; the resolved logo must follow the same contrast rule.
- [ ] Verify Branding & Appearance no longer exposes a Logo URL input.
- [ ] Verify the Files logo picker lists only image MIME types, supports search, shows preview/selected state and can return to default branding.
- [ ] In separate-origin development with `VITE_API_URL`, verify the selected public logo asset is fetched from the API origin rather than the Vite origin.

## 6. Sidebar / collection navigation UX

- [ ] Confirm sidebar hierarchy is visually correct: Content/Files/Settings are primary-level destinations; collection/settings children are smaller/subordinate rather than larger than their parents.
- [ ] Confirm Files is a direct menu item and there is no one-item Library accordion.
- [ ] Collapse/expand the sidebar and verify current collection/section context is preserved and icons remain understandable.
- [ ] Create several collections with different icons; verify selected icons render next to collections under Content.
- [ ] Hide a collection in Data Model Overview; it must disappear from Content without deleting schema/data and reappear when enabled again.
- [ ] Reorder collections with Move up/Move down; verify the Content sidebar order updates and survives page reload.
- [ ] Specifically test two or more legacy collections that previously had no metadata sort value; first reorder must persist rather than becoming a no-op.
- [ ] Check keyboard focus/accordion behavior and narrow-screen sidebar layout.

## 7. Data Model V2 browser smoke

- [ ] Verify the left side is a straightforward project/system collection list with search and no unnecessary collection pagination/sort controls.
- [ ] Selecting a collection opens a single workspace with Overview / Fields / Relations tabs.
- [ ] New collection flow exposes name, description, Content visibility, searchable icon selection and the four recommended accountability fields without unnecessary database jargon.
- [ ] Overview allows description, Content visibility, icon and sidebar order changes from one place.
- [ ] Icon search returns sensible icons and selection survives save/reload/sidebar navigation.
- [ ] Fields tab opens the grouped visual field builder and existing fields remain readable/compact on normal desktop width.
- [ ] Relations tab can still create M2O, O2O and M2M relationships and correctly summarizes existing relations.
- [ ] Verify no separate Content Visibility navigation item remains necessary for normal collection visibility management.
- [ ] Walk the new screen in English and Turkish; no raw `dataModel.*`, `appearance.*`, `fieldBuilder.*` or `collectionBuilder.*` translation keys may leak.

## 8. System collection custom fields

- [ ] As an Administrator/schema manager, open registered system collections `yuncms_users`, `yuncms_files`, `yuncms_roles` in Data Model and verify Add custom field is available.
- [ ] Add a harmless test field to each supported system collection; inspect physical MySQL column + `yuncms_fields` metadata with `systemExtension: true`.
- [ ] Attempt the bounded system-field endpoint against internal system collections such as sessions/tokens/permissions/audit; it must fail closed with `SYSTEM_SCHEMA_READ_ONLY`.
- [ ] Attempt the endpoint as a non-schema-manager; it must fail authorization before DDL.
- [ ] Force/observe a metadata failure in a disposable DB and verify physical added-column compensation removes the partial field.
- [ ] Confirm native system fields remain protected and cannot be altered/deleted through the generic dynamic schema API.
- [ ] Note current V1 boundary: custom system columns are schema extensions, but specialized Users/Files/Roles record screens do not yet provide generic value editors for those extension fields. Do not treat value-editing support as verified until it is implemented separately.

## 9. Existing schema/content regression

- [ ] Create a project collection with default `created_at`, `updated_at`, `created_by`, `updated_by`; verify physical defaults/FKs and actor stamping on create/update.
- [ ] Create Timestamp/Date & time fields with fixed/current-time/auto-update settings and verify MySQL definitions.
- [ ] Create File/Image fields and verify picker/upload/preview persistence.
- [ ] Create O2O, enforce duplicate-target rejection, then remove it and verify FK/UNIQUE cleanup.
- [ ] Re-run Content search/filter/sort/pagination after Data Model/navigation metadata changes.
- [ ] Re-check Users create behavior: management-created users are immediately verified and can log in without email verification.

## 10. Deployment-only hardening

- [ ] Behind the actual reverse proxy configure exact `TRUST_PROXY_HOPS` and verify client IP/rate-limit behavior.
- [ ] Configure/verify HSTS at the real TLS/reverse-proxy layer.
- [ ] If production uses S3-compatible storage, verify upload/list/download/delete, branding logo reads, reconciliation and redacted provider errors against the actual provider.

## 11. Final release decision

- [ ] Only after applicable checks above are removed as successfully completed should this exact branch state be called deployment-verified production ready.
