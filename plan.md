# YunCMS Development Plan

> Live source-status document for branch `16-08-2026`. Source implementation is checked here; real Node/MySQL/browser/provider verification stays in `todo.md`. Completed runtime history is intentionally not duplicated.

## 0. Product / engineering constraints

- [x] Independent Directus-inspired CMS/backend; interaction ideas may be borrowed, visual/product identity is not a Directus clone.
- [x] Node.js 24 LTS, JavaScript/ESM, Express 5.
- [x] MySQL + `mysql2/promise` only; no ORM/query builder or second database driver.
- [x] React 19.2 + Vite 8 Studio.
- [x] REST only; no GraphQL.
- [x] npm workspaces.
- [x] Internal services/extensions never self-request YunCMS over HTTP.
- [x] No GitHub Actions.
- [x] No new UI/i18n/icon package for the current Studio pass.
- [x] Small focused commits; docs/tests travel with source changes.

## 1. Runtime / CLI

- [x] `yuncms init`, `bootstrap`, `start`, `help` CLI surface.
- [x] Node 24 runtime guard.
- [x] Single Express listener serves REST API and built Studio.
- [x] Core/default server port is `3008`.
- [x] Fresh `yuncms init` writes `PORT=3008`, `STUDIO_ORIGIN=http://localhost:3008` and `AUTH_PUBLIC_URL=http://localhost:3008`; legacy 8055/5173 generator values removed.
- [x] Explicit environment values remain operator-controlled; YunCMS does not silently overwrite an existing untracked `.env`.
- [x] Request ids, safe error normalization, security headers, structured logging and graceful shutdown.
- [x] Explicit bounded `TRUST_PROXY_HOPS` configuration.
- [x] Process-local authentication rate limiting with bounded bucket memory.

## 2. MySQL / schema foundation

- [x] Single MySQL pool + pinned transactions + advisory locks.
- [x] Identifier allowlisting / quoted identifiers / placeholder-bound values.
- [x] Retry handling for deadlocks/lock waits.
- [x] Migration journal and compatibility gate.
- [x] Core migrations `0001`–`0006`.
- [x] `0005-default-public-role` guarantees one protected Public role without granting data permissions.
- [x] `0006-studio-settings` stores one bounded Studio branding/theme/default-locale row.
- [x] Schema version + cache; successful API schema mutations invalidate the shared cache.
- [x] DDL compensation/tombstone patterns for destructive dynamic-schema work.

## 3. Dynamic collections / fields

- [x] Collection list/read/create/update/delete.
- [x] Collection Content visibility metadata; non-system hidden collections remain stored but leave Content navigation.
- [x] M2M junction collections hidden by default and manually show/hide configurable.
- [x] Primitive fields: integer, bigint, decimal, string, text, boolean, date, datetime, timestamp, JSON and UUID.
- [x] Required/default/index mutations with validation and compensation.
- [x] Field metadata: readonly, hidden, sort, interface and options.
- [x] Type conversion intentionally excluded from V1.
- [x] Studio semantic File and Image field choices map to UUID physical storage plus `file` / `image` interfaces rather than inventing new MySQL types.
- [x] Core field compiler rejects `file` / `image` interfaces on non-UUID storage.
- [x] Data Model field rows show semantic File/Image type instead of exposing underlying UUID implementation detail.

## 4. Relations

- [x] M2O physical foreign key lifecycle with target/type/on-delete validation and delete compensation.
- [x] O2M inverse metadata reads.
- [x] M2M hidden junction lifecycle with two FKs, unique pair, paired metadata and destructive cleanup compensation.
- [x] O2O is a real backend relation type, not a UI alias: one schema-locked `ALTER TABLE` adds FK + UNIQUE index and metadata records `kind: "o2o"`.
- [x] O2O delete removes FK + UNIQUE in one DDL step and restores them if metadata cleanup fails.
- [x] O2O supports RESTRICT/CASCADE and optional-field SET NULL; required fields reject SET NULL.
- [x] O2O create/delete REST routes are audited and invalidate schema cache.
- [x] Direct to-one Content picker logic handles M2O/O2O metadata.
- [x] Data Model Relations UI uses explicit M2O / O2O / M2M relationship cards plus an existing-relations summary.
- [x] File/Image UUID fields are excluded from relation-source field choices.
- [x] Direct relation target picker remains capped at 200 records in V1; searchable/paginated relation picker is a scale follow-up.
- [x] O2M/M2M nested expansion remains outside V1.

## 5. Generic content / ItemsService

- [x] Generic read/read-one/create/update/delete REST and service paths.
- [x] Server-backed fields/filter/sort/limit/offset/count.
- [x] Safe filter compiler and field/operator allowlists.
- [x] Bulk create/update/delete safeguards and transactional behavior.
- [x] Direct relation expansion reuses target RBAC and source field visibility.
- [x] Content Studio list/create/edit/delete, server text search, filters, sort and pagination.
- [x] Direct relation fields use readable target labels.
- [x] File/Image fields use file-library selectors instead of raw UUID inputs.
- [x] Record form can upload a new file directly into a File/Image field and select it immediately.
- [x] Optional File/Image references can be cleared; required fields preserve required semantics.
- [x] Content tables show readable file metadata/preview instead of raw UUID when file metadata exists.

## 6. Files / preview / storage

- [x] Local filesystem storage driver.
- [x] S3-compatible storage driver.
- [x] File metadata/storage coordination, upload/list/read/content/update/delete.
- [x] Upload size guard, safe physical keys, Unicode-safe download filenames.
- [x] Reconciliation dry-run plus guarded orphan cleanup.
- [x] Files Studio gallery/list, filters, sorting, pagination and metadata editing.
- [x] Shared authenticated `FilePreview` fetches protected file bytes through `/files/:id/content`.
- [x] Rich preview classifier supports image, PDF, video and audio with a clean unsupported-file placeholder.
- [x] Image previews use thumbnails; PDFs embed in the preview surface; video/audio use native controls.
- [x] File/Image record controls and Files library reuse the same preview component.
- [x] Preview classification is isolated into pure JS for cheap Node tests.

## 7. Authentication / users

- [x] Scrypt password hashing, email/password login, access/refresh sessions and refresh rotation.
- [x] Logout current/all sessions and password-change revocation.
- [x] API tokens.
- [x] Password-reset and email-verification one-time token flows.
- [x] Optional SMTP delivery.
- [x] Login/session/refresh/API-token identity queries include human-readable `role_name` in addition to internal role id.
- [x] Studio account footer shows email + role name; raw role UUID is not rendered as user-facing identity copy.

## 8. Roles / permissions / Public access

- [x] Role CRUD with protected Administrator/Public semantics.
- [x] Public role exists after bootstrap/migration but is deny-by-default.
- [x] Anonymous requests use normal action/field/row-filter/write-validation RBAC; no special bypass.
- [x] Read/create/update/delete permission rows.
- [x] Field allowlists, row filters and create/update prospective-record validation.
- [x] Request-local permission cache and mutation invalidation.
- [x] Studio role-first collection/action matrix with search, sorting, configured-only filter and pagination.
- [x] Simple access remains a direct toggle; advanced field/filter/validation editing remains in a focused modal.
- [x] Selected Public role shows explicit anonymous-access guidance.
- [x] Selected non-admin role shows enabled/restricted-rule overview before the matrix.

## 9. Studio shell / navigation UX

- [x] Content / Library / Settings task-oriented navigation.
- [x] Non-system visible collections appear directly under Content rather than a collection dropdown.
- [x] Content, Library and Settings are independent accessible accordion groups.
- [x] Lightweight inline SVG icons cover primary navigation without adding an icon dependency.
- [x] Full sidebar collapse/expand produces a narrow icon rail and preserves current section/content context.
- [x] Clicking an accordion group while collapsed expands the sidebar and opens that group.
- [x] Logo row no longer renders redundant “YunCMS / Studio” copy beside the logo.
- [x] Sidebar account area no longer renders raw role UUID.
- [x] Narrow-screen rules preserve usable navigation rather than forcing the desktop icon rail.

## 10. Branding / theme / localization

- [x] DB-backed Branding & Appearance settings: brand name, logo URL, accent color, Light/Dark/System theme and default EN/TR locale.
- [x] Safe pre-auth GET exposes display-only Studio settings; PATCH is admin/system-only.
- [x] Custom logo replaces Yunsoft logo completely while Yunsoft powered-by/copyright attribution stays independent.
- [x] Default Yunsoft branding resolves theme-specific light/dark logo URLs; custom logos remain unchanged across themes.
- [x] System theme follows browser/OS color scheme and updates resolved theme state.
- [x] Shared CSS custom properties drive surfaces, text, borders, inputs and accents.
- [x] Legacy light-only Studio controls receive explicit dark-surface normalization, including Data Model, permissions, filters, pagination, file controls and preview surfaces.
- [x] English and Turkish base dictionaries plus focused current-UI dictionary modules.
- [x] Personal locale preference can override and later return to the server default.
- [x] Localization core remains pure JS; React hook is a thin adapter.

## 11. Extensions / audit / operations

- [x] `@yunsoft/yuncms-extensions-sdk` with `defineEndpoint` / `defineHook`.
- [x] Local and npm dependency extension discovery with manifest/root/type checks.
- [x] Trusted extension context reuses services, accountability, DB, schema, hooks, storage and request-local permission cache.
- [x] Audit actor/action/collection/item/request-id history with secret redaction.
- [x] Bounded explicit audit cleanup.
- [x] Storage reconciliation and operational docs.

## 12. Source regression coverage

- [x] Low-noise `npm run test:fast`, auto-discovered `npm test`, and build/package `npm run test:release` workflows.
- [x] Port-3008 core config and fresh-init generator tests.
- [x] Public-role / collection-visibility / production-config / request-id / rate-limit regressions.
- [x] Studio-settings public-read/admin-write and branding validation tests.
- [x] Theme-aware Yunsoft/default-vs-custom logo resolution tests.
- [x] EN/TR key parity, static translation-key scan and dynamic field/action label coverage.
- [x] File/Image field payload/storage-interface tests.
- [x] File upload/select/clear/content-preview source contracts and rich preview-kind tests.
- [x] Sidebar accordion/icon/collapse and role-name/no-UUID source contracts.
- [x] Dark-mode legacy/new surface contracts.
- [x] Roles/Public permission guidance and simple-vs-advanced UI source contracts.
- [x] O2O deterministic unique-index and single-lock FK+UNIQUE lifecycle contracts.
- [x] O2O API route/audit source contract.
- [x] Auth refresh identity role-name regression.
- [x] Opt-in real-MySQL integration suite includes O2O uniqueness and File/Image metadata checks without slowing normal fast/full source runs.

## 13. Documentation / handoff

- [x] README + architecture/development/database/REST/auth/permissions/extensions/setup/files/security/deployment/publishing docs.
- [x] Studio customization/localization and production-readiness docs.
- [x] `todo.md` contains only outstanding Codex/runtime/browser/MySQL/provider checks; completed `[x]` history removed.
- [ ] Execute the current Node 24 / MySQL / browser / provider gates in `todo.md` before calling this exact branch deployment-verified production ready.

## 14. Known non-blocking follow-ups

These are not current single-instance V1 source blockers unless scale/product requirements change:

- cluster-wide/shared-store rate limiting for multi-instance deployments;
- shared object storage requirement for multi-instance deployments using files;
- server-side pagination/filtering for Files/Users administrative lists once client-side admin lists outgrow current scale;
- searchable/paginated relation picker beyond the current 200-item target list;
- O2M/M2M nested expansion and richer M2M multi-select content editing;
- binary/uploaded branding asset management instead of URL-only custom logos;
- additional locales beyond English/Turkish;
- session-management UI, MFA and SSO;
- untrusted extension sandbox/marketplace isolation;
- optional scheduled maintenance jobs.
