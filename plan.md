# YunCMS Development Plan

> Live source-status document for branch `21-08-2026`. Checked items describe source-complete behavior only. Node 24/MySQL/browser/provider verification stays in `todo.md` until actually executed.

## 0. Permanent engineering rules

- [x] Node.js 24 LTS, JavaScript/ESM, Express 5, MySQL + `mysql2/promise`, React 19.2 + Vite 8, REST only.
- [x] npm workspaces; no ORM, GraphQL or GitHub Actions.
- [x] Internal code/extensions use services directly and never self-request YunCMS HTTP endpoints.
- [x] Accountability is explicit and authorization lives in services, not UI hiding alone.
- [x] Dynamic identifiers are validated/quoted; SQL data values use placeholders.
- [x] Small focused commits and regression coverage for behavior/schema/authorization/UI changes.
- [x] `todo.md` contains pending verification only; completed checks are removed rather than kept as history.

## 1. Runtime / install

- [x] `yuncms init`, bootstrap/start/help and Node 24 guard.
- [x] API + built Studio use one Express listener.
- [x] Default/fresh-init port contract is 3008 for server, Studio origin and public auth URL.
- [x] Request ids, safe errors, structured logs and bounded trust-proxy handling.
- [x] Browser-facing hardening includes `nosniff`, frame denial, referrer/permissions/CORP/COOP policy, Studio-compatible CSP for default Yunsoft images and blob PDF frames, and HTTPS-only HSTS emission.
- [x] Process-local auth rate limits plus a bounded global API rate limit protect API/auth/extension routes while health/readiness and already-served Studio assets stay available.
- [x] Process-local pressure shedding rejects new API work with `503 + Retry-After` when configured concurrent-request or heap thresholds are reached.

## 2. MySQL / migrations

- [x] MySQL pool, pinned transactions, retryable DB errors and advisory schema locks.
- [x] Migration journal + compatibility gate.
- [x] Core migrations `0001`–`0012` registered.
- [x] `0005`: deny-by-default Public role.
- [x] `0006`: Studio branding/theme/locale.
- [x] `0007`: bounded permission-managed system resources.
- [x] `0008`: nullable Files-backed `logo_file` FK.
- [x] `0009`: human display-name columns for collections and fields, with legacy key backfill.
- [x] `0010`: nullable Files-backed `favicon_file` FK.
- [x] `0011`: Roles resource CRUD actions become explicitly grantable through the normal permission engine without adding default grants.
- [x] `0012`: Files permissions gain narrowly scoped row filters for `read` while create/update/delete remain action-level only.
- [x] Dynamic schema mutations retain version/cache invalidation and compensation patterns.

## 3. Human names vs stable API keys

- [x] Collections store `name` separately from stable `collection` API/MySQL key.
- [x] Fields store `name` separately from stable `field` API/MySQL key.
- [x] Studio accepts natural names with spaces, Turkish characters and Unicode.
- [x] Turkish normalization examples: `Müşteri Talepleri -> musteri_talepleri`, `Ürün Fiyatı -> urun_fiyati`, `İçecek Ölçüsü -> icecek_olcusu`.
- [x] Leading numeric names receive a safe semantic prefix.
- [x] Backend repeats normalization; correctness does not depend on browser-only logic.
- [x] Studio shows the human label prominently and the API key as secondary technical information.
- [x] Changing a display name later does not silently rename physical tables/columns or integration URLs.
- [x] Registered custom system fields use the same name/key separation.

## 4. Collections / Data Model

- [x] Project collection create/read/update/delete and metadata.
- [x] Data Model is a collection workspace with `Overview / Fields / Relations` rather than a settings-heavy paginated form.
- [x] Collection list remains visible and shows display label + machine key.
- [x] Overview owns display name, description, Content visibility, icon and sidebar order.
- [x] Searchable collection icon registry with no added icon dependency.
- [x] Content visibility is managed inside Data Model; separate Content Visibility navigation is removed.
- [x] Content sidebar uses collection display names, icons, visibility and persisted order.
- [x] Drag-and-drop and explicit move-up/down ordering normalize sort values into stable slots.
- [x] New collections default to recommended accountability fields: `created_at`, `updated_at`, `created_by`, `updated_by`.
- [x] Data Model remains responsive and theme-variable driven.

## 5. Fields / relations

- [x] Primitive fields: string/text/integer/bigint/decimal/boolean/date/datetime/timestamp/json/uuid.
- [x] Visual field builder separates Display name from generated/editable API key.
- [x] Decimal precision/scale, supported defaults, current-time presets and timestamp auto-update.
- [x] File/Image are semantic UUID-backed fields with dedicated picker/preview behavior.
- [x] M2O physical FK lifecycle.
- [x] O2O physical FK + UNIQUE lifecycle and compensation.
- [x] M2M managed junction lifecycle.
- [x] Relations workspace supports M2O/O2O/M2M creation, summary and deletion.
- [x] Relation selectors show human labels while submitting stable machine keys.
- [x] Schema managers can add bounded optional custom fields to Users/Files/Roles system collections; internal sessions/tokens/permissions/audit remain closed.

## 6. Items API / content

- [x] Project collection read/read-one/create/update/delete.
- [x] `fields`, `filter`, `sort`, `limit`, `offset` and legacy direct `expand` query surface.
- [x] Directus-style direct-relation field selection supports `fields=*`, `fields=*.*`, `relation.*` and `relation.field` while preserving field/row RBAC at both source and target levels.
- [x] Filter operators include comparisons, IN/NOT IN, NULL checks, text matching and nested AND/OR.
- [x] Query complexity is bounded: fields/sort counts, direct-relation expansion count, maximum offset, filter depth/node count and public IN/NOT-IN list size fail closed before expensive SQL is generated.
- [x] RBAC row filters and field allowlists remain part of every query.
- [x] Direct to-one relation expansion reuses target RBAC, keeps hidden target lookup keys internal, batches 500-row lookups and supports one relation depth with a 20-relation complexity budget instead of the former eight-field cap.
- [x] Generic ItemsService refuses system collections so specialized safeguards cannot be bypassed.
- [x] Detailed Items query-language documentation includes operator tables, curl examples, pagination, wildcard/nested relation fields and JavaScript usage.

## 7. Files / previews / branding assets

- [x] Local and S3-compatible storage drivers.
- [x] File upload/list/read/content/update/delete and reconciliation safeguards.
- [x] Upload size is bounded and common declared media types (PDF/PNG/JPEG/GIF/WebP) are checked against file signatures before storage/metadata writes.
- [x] Files gallery/list with search/filter/sort/pagination.
- [x] Authenticated preview supports image/PDF/video/audio plus unsupported placeholder.
- [x] Gallery media uses contain-style presentation instead of crop-style cover presentation.
- [x] Files gallery/list exposes a dedicated large preview modal.
- [x] File/Image content fields can select existing Files or upload a new file.
- [x] Branding asset settings use a compact summary and open a Files modal on demand rather than rendering the entire image library inline.
- [x] Branding Files modal filters to images, supports search and renders 12 results per page.

## 8. Authentication / Users / permissions

- [x] Scrypt passwords, sessions, refresh rotation, logout/revocation, API tokens and reset/verification flows.
- [x] Management-created users are immediately verified.
- [x] Human-readable `role_name` propagates through auth identity and sidebar presentation.
- [x] Delegated user managers cannot assign Administrator/Public roles, cannot modify Administrator accounts and cannot move themselves or other users to a different non-admin role to gain power.
- [x] Users/Files CRUD permissions and Roles CRUD delegation use the same explicit permission engine; service-level escalation/data-integrity invariants remain enforced.
- [x] Public and ordinary roles are deny-by-default but are not blanket-blocked by role type: an administrator may explicitly grant any action that a permission-managed resource exposes.
- [x] Files `read` permissions may optionally carry a server-side row filter; list, single-record and content reads enforce the same filter before storage access.
- [x] Project permissions support action toggles, field allowlists, row filters and write validation.
- [x] Permission decisions use a bounded process-local memory cache shared across requests; permission mutations invalidate it immediately and the async store contract is ready for a future shared adapter.
- [x] User/role/permission create/update/delete and password-change events are covered by central audit actions without placing password material into audit payloads.
- [x] Dark-mode permission matrix, sticky cells, pagination and permission-rule count badges use Studio surface variables rather than white backgrounds.

## 9. Studio shell / navigation

- [x] Content accordion contains dynamic collections.
- [x] Files is a direct root destination; no pointless one-item Library accordion.
- [x] Settings groups Data Model, Users, Roles & Permissions and Branding & Appearance.
- [x] Parent navigation is visually stronger than children.
- [x] Collection children show human label + configured icon while retaining stable machine identity internally.
- [x] Sidebar can collapse to an icon rail without losing section context.

## 10. Branding / appearance / localization

- [x] Brand name, accent, Light/Dark/System and EN/TR default locale remain server-backed.
- [x] Logo is selected from existing image Files; arbitrary external logo editing is removed.
- [x] Favicon is selected from existing image Files through the same modal interaction.
- [x] `logo_file` / `favicon_file` use nullable Files FKs with `ON DELETE SET NULL`.
- [x] Narrow public `/studio-settings/logo` and `/studio-settings/favicon` expose only the configured branding image without making Files public.
- [x] Branding image responses use revalidation and CSP sandboxing.
- [x] Default dark surface uses `light-logo.png`; light surface uses `dark-logo.png`.
- [x] Default favicon is the Yunsoft `light-icon.png` asset and is present in initial HTML before React hydration.
- [x] Custom branding asset paths respect configured API origin in split-origin development.
- [x] English/Turkish copy covers schema labels, Files asset modal, favicon and current Data Model UX.

## 11. Documentation

- [x] README is product-oriented and explains architecture, capabilities, quick start, schema naming and API examples.
- [x] `docs/rest-api.md` is a detailed endpoint reference with auth, Items, schema, relations, Users/Roles/Files, branding and health examples.
- [x] `docs/api-query-language.md` documents all implemented collection query parameters/operators, URL encoding, pagination, nested filters, Directus-style wildcard/direct-relation fields and legacy expansion.
- [x] `docs/permissions.md` documents deny-by-default explicit grants, filtered Files reads, delegated-role escalation boundaries and process-local permission caching.
- [x] Studio customization documentation covers Files-backed logo/favicon selection and public branding endpoints.
- [x] Existing architecture/auth/permissions/files/database/security/deployment documentation remains linked from README.

## 12. Source regression coverage

- [x] Low-noise `npm run test:fast`, auto-discovered `npm test`, and `npm run test:release` runner.
- [x] Port/init/config and migration compatibility tests.
- [x] Query-complexity, global rate-limit and server-pressure source regressions.
- [x] Permission-cache reuse/invalidation and filtered Public Files source regressions.
- [x] Security-sensitive audit-event regression coverage keeps password material out of audit payloads.
- [x] Core + Studio schema-name normalization tests.
- [x] Human field-label/API-key payload tests.
- [x] Data Model V2 label/key, ordering, relation and system-field source contracts.
- [x] `fields=*`, `fields=*.*`, direct nested field selection, hidden target-key projection, 500-row lookup batching and bounded legacy expansion regression contracts.
- [x] Public Files deny-without-grant / allow-with-explicit-grant core and Studio permission-matrix contracts.
- [x] Roles create/update/delete deny-without-grant / allow-with-explicit-grant contracts, including Public-configurable action metadata and protected administrator/public role invariants.
- [x] Shared Studio confirmation dialogs remain distinct from forbidden native browser dialogs.
- [x] Files full-preview and contain-style UI contracts.
- [x] File-backed logo/favicon service/API/client source contracts.
- [x] Dark pagination/permission/badge surface contracts.
- [x] EN/TR parity/static key scan remains in the complete suite.
- [ ] Execute Node 24, real MySQL and browser gates in `todo.md` before calling this exact source state deployment-verified.

## 13. Known follow-ups, not current source claims

- Server-side search/pagination for very large Files/Users/relation-picker datasets; current branding modal only limits rendered results client-side.
- O2M/M2M nested expansion and recursive relation depths beyond the current direct to-one field engine.
- Generic value editors for custom extension columns inside specialized Users/Files/Roles record screens.
- Dedicated migration workflow for adding accountability fields to pre-existing project collections.
- Shared Redis-compatible cache/invalidation and distributed rate-limit state before multi-process/container deployment; current cache/rate/pressure stores are process-local.
- Permission-aware API response/output caching; current cache intentionally covers authorization decisions only.
- MFA/SSO and richer session-management UI before higher-assurance public deployments.
- Optional malware/antivirus scanning policy for environments that accept untrusted file uploads.
- Extensions remain trusted server-side code by design in the current product model.
