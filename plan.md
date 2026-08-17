# YunCMS Development Plan

> Live source-status document for branch `16-08-2026`. Source-complete behavior is checked here. Anything that still needs an actual Node 24 checkout, MySQL, browser, SMTP/S3 or deployment environment belongs in `todo.md`.

## 0. Permanent engineering rules

- [x] Node.js 24 LTS, JavaScript/ESM, Express 5, MySQL + `mysql2/promise`, React 19.2 + Vite 8, REST only.
- [x] npm workspaces; no ORM, GraphQL, speculative monorepo tooling or GitHub Actions.
- [x] Internal code/extensions call services directly and never self-request YunCMS HTTP endpoints.
- [x] Accountability is explicit; public/system/admin behavior never comes from a null identity.
- [x] Dynamic identifiers are validated/quoted and SQL values use placeholders.
- [x] Small focused commits.
- [x] Every behavior/config/schema/authorization/UI change receives regression coverage. Unexecutable verification is tracked in `todo.md`; passed checks are removed rather than archived there.

## 1. Runtime / install

- [x] `yuncms init`, bootstrap/start/help and Node 24 guard.
- [x] API + built Studio use one Express listener.
- [x] One `DEFAULT_SERVER_PORT = 3008` is shared by core runtime and fresh init.
- [x] Fresh init writes `PORT=3008`, `STUDIO_ORIGIN=http://localhost:3008`, `AUTH_PUBLIC_URL=http://localhost:3008`.
- [x] `.env.example` uses 3008.
- [x] Request ids, safe errors, security headers, structured logs, bounded trust-proxy and auth rate limits.

## 2. MySQL / migrations

- [x] MySQL pool, pinned transactions, retryable DB errors and advisory schema locks.
- [x] Migration journal + compatibility gate.
- [x] Core migrations `0001`–`0008` are registered.
- [x] `0005` creates the deny-by-default Public role.
- [x] `0006` creates Studio branding/theme/locale settings.
- [x] `0007` registers only bounded permission-managed system resources: Users, Files and Roles.
- [x] `0008` adds a nullable `logo_file` FK to `yuncms_files` with `ON DELETE SET NULL`.
- [x] Schema version/cache invalidation and DDL compensation patterns remain in place.

## 3. Collections / Data Model

- [x] Project collection create/read/update/delete and metadata.
- [x] New collection creation can add `created_at`, `updated_at`, `created_by`, `updated_by`; all four are recommended/default-on in Studio.
- [x] Actor/date fields are physically backed and system-managed; ItemsService stamps them and callers cannot overwrite them.
- [x] Data Model now uses a collection-workspace flow rather than the old paginated settings-heavy layout.
- [x] Collection list stays visible; selecting a collection opens `Overview / Fields / Relations`.
- [x] Collection visibility is edited directly in Data Model Overview; separate Content Visibility navigation is removed.
- [x] Collections have a searchable icon picker with an internal icon registry and no added icon dependency.
- [x] Collection icon + sidebar sort live in collection metadata.
- [x] Content sidebar uses collection metadata icon/order and ignores hidden/system collections.
- [x] Collections can be moved up/down from Data Model; legacy collections receive stable reorderable fallback sort values.
- [x] New collection create flow includes visibility, icon and accountability settings in one workspace.
- [x] Data Model is responsive and uses theme variables rather than light-only surfaces.

## 4. Fields

- [x] Primitive fields: string/text/integer/bigint/decimal/boolean/date/datetime/timestamp/json/uuid.
- [x] Grouped visual field builder with type cards and relevant-only settings.
- [x] Decimal precision/scale.
- [x] Fixed defaults plus current-time defaults for datetime/timestamp.
- [x] Timestamp auto-update with preserved schema metadata.
- [x] Browser `datetime-local` values normalize to MySQL date-time format.
- [x] File/Image are semantic UUID-backed fields with dedicated picker/preview behavior.
- [x] Native/system-managed fields remain protected.
- [x] A dedicated bounded service/route allows schema administrators to add custom fields to registered Users/Files/Roles system collections without opening internal Sessions/Tokens/Permissions/Audit tables.
- [x] Custom system additions are tagged `systemExtension: true` in schema metadata and use locked/compensated DDL.

## 5. Relations

- [x] M2O physical FK lifecycle.
- [x] O2O physical FK + UNIQUE lifecycle, compensation and REST routes.
- [x] M2M junction lifecycle.
- [x] Data Model Relations workspace separates M2O/O2O/M2M and summarizes existing relationships.
- [x] File/Image and system-managed UUID fields are excluded as relation-source fields.
- [x] Relation target picker remains capped at 200 records in V1; server-paginated relation search is a scale follow-up.

## 6. Content / Files

- [x] Generic project collection CRUD with fields/filter/sort/limit/offset/count and RBAC.
- [x] Generic ItemsService refuses system collections so specialized safeguards cannot be bypassed.
- [x] Content list/create/edit/delete and relation/file inputs.
- [x] Local and S3-compatible storage drivers.
- [x] File upload/list/read/content/update/delete and reconciliation safeguards.
- [x] Files gallery/list UX.
- [x] Authenticated preview supports image/PDF/video/audio plus unsupported placeholder.
- [x] File/Image content fields can select existing Files or upload a new file.

## 7. Authentication / Users

- [x] Scrypt passwords, sessions, refresh rotation, logout/revocation, API tokens, reset/verification token flows.
- [x] First admin and every account created through privileged UsersService management are immediately email-verified.
- [x] Existing email-verification flow remains available for legacy/unverified accounts.
- [x] Human-readable `role_name` is propagated through login/refresh/API-token identity.
- [x] Sidebar shows email + role name, never raw role UUID.
- [x] Users CRUD can be delegated through bounded system-resource permissions.
- [x] Delegated user managers cannot assign Public/Admin roles or mutate/delete administrator accounts.
- [x] Self password changes revoke sessions; delegated managers cannot change another user's password.
- [x] Users Studio degrades safely when Users access exists without Roles: Read.

## 8. Roles / permissions

- [x] Project collection read/create/update/delete permissions, field allowlists, row filters and write validation.
- [x] Public role remains deny-by-default.
- [x] Users/Files can be delegated action-by-action; Roles can be delegated read-only.
- [x] Public cannot receive system-resource permissions.
- [x] Internal system resources remain fail-closed.
- [x] Permission-managed system resources are action-only; fake advanced field/filter editors are not shown.
- [x] Role screen has Public guidance and access overview.
- [x] Dark-mode permission matrix/sticky cells use Studio surface variables instead of white backgrounds.

## 9. Sidebar / Studio UX

- [x] Content remains the only accordion containing dynamic collections.
- [x] Files is a direct root destination; the pointless one-item Library accordion is removed.
- [x] Settings remains an accordion for Data Model, Users, Roles & Permissions and Branding & Appearance.
- [x] Parent navigation is visually stronger than child navigation.
- [x] Collection child entries use selected collection icons.
- [x] Sidebar can fully collapse to an icon rail.
- [x] Redundant `YunCMS Studio` copy beside the logo remains removed.
- [x] Pagination surfaces use theme variables in dark mode.

## 10. Branding / appearance

- [x] Brand name, accent, Light/Dark/System theme and EN/TR default locale remain server-backed.
- [x] Arbitrary logo URL entry has been removed from current Studio editing.
- [x] Administrator chooses an existing `image/*` item from Files through a searchable logo picker.
- [x] Selected logo is stored as `logo_file`; deleting that File clears the reference via FK.
- [x] A narrow public `/studio-settings/logo` endpoint exposes only the configured branding image so pre-login branding works without making Files public.
- [x] File-backed logo resolution honors `VITE_API_URL`/API origin in separate-origin development.
- [x] Default Yunsoft artwork mapping is corrected: dark Studio uses `light-logo.png`; light Studio uses `dark-logo.png`.
- [x] Custom logo replaces Yunsoft artwork while Powered by Yunsoft attribution remains independent.
- [x] English/Turkish copy covers current logo picker, Data Model workspace, fields and permission UX.

## 11. Source regression coverage

- [x] Low-noise `npm run test:fast`, auto-discovered `npm test`, and `npm run test:release` runner.
- [x] Port 3008/init/config contracts.
- [x] Migration/bootstrap compatibility including `0008`.
- [x] Accountability/timestamp/File/Image/O2O/system-resource permission contracts.
- [x] Management-created verified-user and delegated-user guards.
- [x] Dark pagination/permission surface contracts.
- [x] Files-backed branding service/client/source contracts.
- [x] Collection icon/search/order/metadata contracts.
- [x] Data Model V2 source/workspace/system-field contracts.
- [x] Sidebar hierarchy/direct-Files contracts.
- [x] EN/TR parity/static key scan plus dynamic field/action/Data Model tab coverage.
- [ ] Execute the changed test suites and browser/MySQL verification in `todo.md` before calling this exact source state deployment-verified.

## 12. Known follow-ups, not current source claims

- Server-side pagination/search for very large Files/Users/relation-picker datasets.
- O2M/M2M nested expansion and richer M2M editing.
- Full generic editing of custom extension fields inside specialized Users/Files/Roles record screens; current work adds the schema fields safely, while specialized service screens still own their native record contracts.
- Adding accountability fields to pre-existing project collections through a dedicated migration workflow.
- Shared-store rate limiting/object storage requirements for multi-instance deployment.
- MFA/SSO/session-management UI and untrusted extension sandboxing.
