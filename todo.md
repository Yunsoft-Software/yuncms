# Environment / Manual TODO

Only checks that still require a real Node 24 checkout, browser, MySQL instance or deployment provider belong here. This is a **pending verification list**: when a check passes it is removed, not kept as `[x]` history. If its covered source changes later, it becomes pending again.

Current assistant environment cannot execute the release gates: it has Node `22.16.0`, npm `10.9.2`, and the container cannot resolve `github.com`. Do not treat source inspection as executed verification. For the managed-upgrade work, Codex should follow `docs/codex-managed-upgrade-verification.md` and leave command/evidence notes without secrets.

## 1. Directus-style fields / relation query smoke

- [ ] Create a direct M2O relation such as `articles.author_id -> authors.id` and verify `GET /items/articles?fields=*` returns all readable source fields without expanding `author_id`.
- [ ] Verify `GET /items/articles?fields=*.*` returns all readable source fields and expands every readable direct to-one relation exactly one level.
- [ ] Verify `GET /items/articles?fields=id,title,author_id.*` returns the selected source fields plus all readable author fields.
- [ ] Verify `GET /items/articles?fields=id,author_id.name` returns only `name` inside the expanded author object while still using the target key internally for lookup.
- [ ] Verify source and target field allowlists plus target row filters still apply to `*.*`, `relation.*` and `relation.field` and cannot be widened by wildcards.
- [ ] Verify legacy `expand=author_id` still works, accepts up to 20 direct relations and rejects a 21st before target queries execute.
- [ ] Verify deeper paths and junction/M2M expansion fail closed with the documented unsupported-relation error until those capabilities are implemented.
- [ ] Exercise the configured query limits with oversized fields/sort arrays, deep/numerous filter nodes, oversized IN lists and an offset above the configured maximum; all must fail before an expensive SQL query executes.

## 2. Explicit system-resource permission smoke

- [ ] With no Public `yuncms_files:read` permission, anonymous Files list/read/content requests must remain forbidden and must not query file metadata/content after permission denial.
- [ ] In Studio select the Public role and grant Files `read`; the control must be configurable instead of disabled.
- [ ] After an explicit **unfiltered** Files read grant, anonymous Files list/read/content must preserve the existing all-Files behavior through Public accountability.
- [ ] Add a Files `read` row filter (for example a controlled title/uploader/MIME predicate); anonymous list/read/content must expose only matching rows and a non-matching content request must not read the storage object.
- [ ] Verify a Files permission rejects field allowlists/validation and rejects row filters on create/update/delete; only `read` row filters are supported by the system-resource mode.
- [ ] Remove the Files grant and confirm anonymous Files access immediately returns to deny-by-default behavior and the process-local permission cache does not retain the old grant.
- [ ] For a normal custom role, verify Roles create/update/delete all fail without their exact permission rows.
- [ ] Grant only `yuncms_roles:create`; verify ordinary role creation works but Roles read/update/delete remain denied.
- [ ] Grant Roles update/delete separately and verify each becomes available without requiring an unrelated Roles read grant.
- [ ] Select Public in Studio and verify Roles create/update/delete toggles are configurable too; leave them disabled unless intentionally needed.
- [ ] Even with Users update granted, verify a delegated non-admin caller cannot move itself or another user to a different non-admin role, cannot assign Administrator/Public, and cannot modify an Administrator account.
- [ ] Even with Roles create granted, verify a non-admin caller cannot create a new Administrator/Public role as a side effect; protected role semantics remain enforced independently from action permission.
- [ ] Verify Administrator/Public roles cannot be deleted through delegated Roles delete and roles assigned to users remain protected from deletion.
- [ ] Verify non-permission-managed system collections such as permissions/sessions/tokens/audit remain non-delegatable.

## 3. Fresh install / port 3008

- [ ] In a new empty project run `yuncms init`; generated `.env` must contain `PORT=3008`, `STUDIO_ORIGIN=http://localhost:3008`, `AUTH_PUBLIC_URL=http://localhost:3008`.
- [ ] Start without manually setting a port and verify API + built Studio are served from `http://localhost:3008`.
- [ ] Confirm fresh-install output/docs do not direct users to legacy 8055 or Vite 5173.
- [ ] Migrate any existing operator-owned `.env` that still explicitly uses a legacy port; source intentionally does not overwrite it.

## 4. Real MySQL migration upgrade

Use a disposable MySQL 8-compatible database whose name contains `test`, `ci` or `dev`.

- [ ] Upgrade a DB applied through `0008`; bootstrap must apply `0009-schema-display-names`, `0010-studio-favicon-file`, `0011-role-permission-actions` and `0012-files-read-filters` exactly once, then compatibility must pass.
- [ ] Verify `0009` backfills `yuncms_collections.name = collection` and `yuncms_fields.name = field` for legacy rows before making the columns NOT NULL.
- [ ] Verify `logo_file` and `favicon_file` are nullable indexed `CHAR(36)` FKs to `yuncms_files(id)` with `ON DELETE SET NULL`.
- [ ] Verify `0011` updates only `yuncms_roles` permission metadata so `allowedActions` is exactly `read/create/update/delete` and does not create any permission rows automatically.
- [ ] Verify `0012` updates only `yuncms_files` permission metadata to `permissionMode=filter-read`, increments schema state and does not create/expand any permission row automatically.

## 5. Human collection / field names

- [ ] In Studio create `Müşteri Talepleri`; verify the suggested machine key is `musteri_talepleri`, the display label remains exactly `Müşteri Talepleri`, and the physical/API collection key is normalized.
- [ ] Create fields such as `Ürün Fiyatı`, `İçecek Ölçüsü`, `Çalışma Şekli / Gün`; verify Turkish characters/spaces remain in labels while API keys normalize deterministically.
- [ ] Create a leading-number label such as `2026 Ürünleri`; verify a safe prefixed machine key is generated.
- [ ] Change an existing collection/field **display name** after data exists; verify the MySQL table/column and REST integration key do not rename.
- [ ] Verify sidebar, Data Model lists and relation selectors show the human label while technical key remains secondary/available.
- [ ] Exercise the same naming behavior through raw Schema REST requests so server-side normalization is proven independently from Studio.

## 6. Files preview / upload security regression

- [ ] Upload genuine PDF/PNG/JPEG/GIF/WebP samples with matching declared MIME types and confirm they succeed.
- [ ] Upload arbitrary bytes while falsely declaring one of those known MIME types; request must fail with `FILE_MIME_MISMATCH` before storage or metadata write.
- [ ] Verify unknown/non-signature-checked file types still follow the existing generic upload path rather than being blanket rejected.
- [ ] In Files Gallery open a large portrait, landscape and transparent image; card preview must use `contain` instead of cropping and the Preview action must open the entire asset in the large modal.
- [ ] Open a PDF in the large modal and verify it remains usable at normal desktop height.
- [ ] Open video and audio files; native controls and authenticated blob loading must work.
- [ ] Verify unsupported files show a clean placeholder rather than a broken media element.
- [ ] Repeat in List view and confirm preview action opens the same full preview surface.
- [ ] Test file preview after an access-token refresh to ensure authenticated `apiBlob` behavior still succeeds.

## 7. Dark-mode regression from supplied screenshots

- [ ] Content pagination footer must stay dark; no white strip.
- [ ] Files Gallery/List result and pagination surfaces must stay dark.
- [ ] Roles & Permissions search/header/sticky first column/body/footer must stay dark.
- [ ] Specifically verify the `permission rules` count badge / role summary stat is readable and not white in Dark mode.
- [ ] Check hover/focus/active states for permission cells, badges and pagination in both themes.
- [ ] Smoke Content, Files, Users, Data Model, Roles and Branding once in Light and once in Dark for any remaining hard-coded light surface.

## 8. Logo / favicon Files modal

- [ ] Branding & Appearance must show compact Logo and Favicon asset summaries, not an inline dump of the full Files library.
- [ ] Clicking **Select from Files** must open a modal that lists only images, supports search and renders 12 items per page.
- [ ] Seed at least 100 images and verify the settings page remains compact and the modal paginates rather than rendering all 100 candidates at once.
- [ ] Select a logo, save, sign out/reload login and verify `/studio-settings/logo` renders that exact image before authentication.
- [ ] Select a favicon, save and verify the browser tab switches to `/studio-settings/favicon` without a full application restart.
- [ ] Delete selected logo/favicon Files and verify their FKs become `NULL` and Studio returns to default assets.
- [ ] Confirm non-image Files and arbitrary external logo URLs are rejected by the service even through raw API requests.
- [ ] In separate-origin development with `VITE_API_URL`, verify custom logo/favicon assets are fetched from the API origin rather than the Vite origin.
- [ ] Verify public logo/favicon responses use `no-cache, must-revalidate` and CSP `sandbox` while arbitrary Files remain protected unless Public Files read was explicitly granted.

## 9. Data Model / navigation browser smoke

- [ ] Verify project/system collection list remains simple, searchable and free of unnecessary pagination/sort widgets.
- [ ] Selecting a collection opens `Overview / Fields / Relations` in one workspace.
- [ ] New collection flow exposes Display name, API key, description, Content visibility, searchable icon and recommended accountability fields in understandable order.
- [ ] Overview can change human display name, description, visibility, icon and sidebar order without changing collection key.
- [ ] Fields tab shows human field labels with machine keys secondary and can add fields through the grouped builder.
- [ ] Relations tab creates/deletes M2O, O2O and M2M and shows human labels in selectors while submitting machine identifiers.
- [ ] Hide/show a collection and verify Content sidebar updates without schema/data deletion.
- [ ] Reorder collections by drag-and-drop and move buttons; order must persist after reload. Drag must remain disabled while collection search is filtering the list.
- [ ] Walk Data Model in EN/TR and ensure no raw localization keys leak.

## 10. System collection extension fields

- [ ] As schema manager, add naturally named optional custom fields to `yuncms_users`, `yuncms_files`, `yuncms_roles`; verify normalized key + human name + physical column + `systemExtension: true` metadata.
- [ ] System field builder must not expose Required for these additions; raw `required:true` must fail `SYSTEM_EXTENSION_REQUIRED_UNSUPPORTED` before DDL.
- [ ] Internal sessions/tokens/permissions/audit system collections must reject the bounded endpoint with `SYSTEM_SCHEMA_READ_ONLY`.
- [ ] Non-schema-manager must fail authorization before DDL.
- [ ] Force a metadata failure in disposable DB and verify compensation removes the added physical column.
- [ ] Native system fields must remain protected.
- [ ] Current V1 boundary remains: specialized Users/Files/Roles screens do not yet generically edit values of newly added extension columns.

## 11. Existing data / relation regression

- [ ] Create a project collection with `created_at`, `updated_at`, `created_by`, `updated_by`; verify physical defaults/FKs and actor stamping.
- [ ] Create timestamp/date-time fields with fixed/current-time/auto-update behavior and verify MySQL definitions.
- [ ] Create File/Image fields and verify picker/upload/full preview persistence.
- [ ] Create O2O, confirm duplicate-target rejection, then delete it and verify FK/UNIQUE cleanup.
- [ ] Re-run Content search/filter/sort/pagination after name/metadata changes.
- [ ] Re-check management-created Users remain immediately verified and can sign in without an email verification wait.

## 12. Security / cache / audit runtime smoke

- [ ] Sign in and verify authenticated Studio navigation plus image/PDF/video/audio previews remain usable under the default CSP.
- [ ] Through a real TLS-aware reverse proxy, verify HTTPS requests receive HSTS while direct HTTP development does not falsely emit it.
- [ ] Verify global API rate limiting returns `429`/rate-limit headers at the configured threshold and client IP bucketing uses the intended proxy hop configuration.
- [ ] Lower `PRESSURE_MAX_CONCURRENT` in a disposable environment and verify excess API requests receive `503`, `SERVER_PRESSURE` and `Retry-After`, then recover after active requests finish.
- [ ] Lower `PRESSURE_MAX_HEAP_PERCENT` only in a disposable environment and verify heap pressure sheds new API work without making `/health`, `/ready` or already-served Studio assets unavailable.
- [ ] With cache enabled, repeat the same role/collection/action request and verify permission resolution reuses the process-local cache; modify/delete that permission and verify the next authorization decision reflects the change immediately.
- [ ] With `CACHE_ENABLED=false`, verify authorization still works correctly without relying on cache state.
- [ ] Confirm user/role/permission mutations appear in audit history with actor/request id and that `users.password.update` contains no plaintext password or password hash material.

## 13. Documentation smoke

- [ ] Follow README quick start in a clean checkout and confirm commands/URLs match reality.
- [ ] Run representative examples from `docs/api-query-language.md`: `fields=*`, `fields=*.*`, `relation.*`, `relation.field`, nested AND/OR filter, IN, NULL, text contains, multi-sort, pagination and legacy direct expand.
- [ ] Run the Public Files example from `docs/permissions.md`: deny before grant, allow all after an explicit unfiltered read grant, restrict results/content after adding a read filter, deny again after removal.
- [ ] Run the Roles explicit-grant examples from `docs/permissions.md`: no grant = deny, exact create/update/delete grant = enable that action, protected Administrator/Public role semantics remain intact.
- [ ] Run representative schema examples from `docs/rest-api.md`, including natural display names and stable API keys.

## 14. Deployment-only hardening

- [ ] Behind the actual reverse proxy configure exact `TRUST_PROXY_HOPS` and verify client IP/rate-limit behavior.
- [ ] Configure/verify HSTS at the real TLS/reverse-proxy layer in addition to application-side secure-request handling.
- [ ] If more than one API process/container is deployed, do **not** assume the current memory cache/rate-limit state is shared; add/verify a shared Redis-compatible store before relying on cross-instance cache invalidation or distributed limiting.
- [ ] If production uses S3-compatible storage, verify upload/list/download/delete, full previews, branding logo/favicon reads, reconciliation and redacted provider errors against the actual provider.

## 15. Backup / restore / managed update release gate

These checks were added for the `22-08-2026` managed upgrade implementation and require a real Node 24/npm/MySQL/process environment. Do not mark the upgrade path production-verified from source tests alone. Follow the exact runbook in `docs/codex-managed-upgrade-verification.md`.

### Source and CLI gates

- [ ] On a real Node.js 24 checkout run `npm run test:fast`, `npm test` and `npm run test:release`; the migration-attempt, backup/restore, SemVer, dependency-section, update preflight, operation-lock and rollback regression tests must all pass.
- [ ] Verify `npm run test:fast` actually includes every managed-upgrade CLI regression file, including `update-dependency-section.test.js`; do not accept only full-suite coverage.
- [ ] Pack/install the publishable `@yunsoft/yuncms` artifacts into a clean npm project that declares `@yunsoft/yuncms` in `package.json`; verify `yuncms help` exposes `backup`, `restore`, `update` and `update --dry-run` without regressing `init/bootstrap/start`.
- [ ] Verify a project with no `@yunsoft/yuncms` dependency and a project with no installed `node_modules/@yunsoft/yuncms` fail managed update before mutation with the documented project/package errors.
- [ ] Verify an invalid installed package version fails with `UPDATE_INSTALLED_VERSION_INVALID` before backup/mutation.
- [ ] Run `yuncms update --dry-run` against a real published target and confirm npm target resolution plus loading `REQUIRED_CORE_MIGRATION_IDS` from the staged target package works with lifecycle scripts disabled during inspection.
- [ ] Verify SemVer prerelease precedence with real/published targets when available: stable -> prerelease must be treated as downgrade; prerelease -> stable must be allowed.
- [ ] Verify a target version lower than the installed version is rejected with `UPDATE_DOWNGRADE_FORBIDDEN` and no package/database mutation occurs.
- [ ] Verify unknown applied migration IDs not present in the target package produce `UPDATE_MIGRATION_HISTORY_INCOMPATIBLE` and prevent update.
- [ ] Verify a project that stores `@yunsoft/yuncms` under `devDependencies` remains there after update (`--save-dev`), and one under `optionalDependencies` remains optional (`--save-optional`).

### Dedicated automated MySQL upgrade gate

Use a **separate disposable database** that is not the normal integration DB. Its name must contain `test`, `ci` or `dev`.

Set:

```text
YUNCMS_TEST_MYSQL=1
YUNCMS_TEST_UPGRADE=1
YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1
YUNCMS_UPGRADE_TEST_DB_DATABASE=<dedicated_test_database>
```

plus the normal `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` values.

- [ ] Run `npm run test:upgrade:mysql`; both tests in `test/integration/managed-upgrade.test.js` must pass.
- [ ] Confirm the partial-DDL test records `status=failed`, `statement_index=1`, and retry fails with `DATABASE_MIGRATION_RECOVERY_REQUIRED` before re-executing statement 1.
- [ ] Confirm the real `mysqldump` round-trip restores the pre-backup DB row, removes post-backup table/view objects, restores local Files/extensions/package/env bytes, and leaves no DB password/S3 secret in the manifest.
- [ ] Confirm the dedicated test DB is cleaned afterward; a failed test must not leave synthetic failed migration attempts that poison later bootstrap runs.

### Real MySQL backup / restore

Use a disposable dedicated MySQL 8-compatible database with representative custom collections, relations, users/roles/permissions, audit rows and Files metadata.

- [ ] Confirm the production MySQL client tools (`mysqldump`, `mysql`) used on the host accept the generated TCP/UTF-8/SSL arguments and that the configured YunCMS DB user has the exact privileges needed for table/data/trigger dump and restore.
- [ ] Run `yuncms backup` with the service stopped; verify `database.sql.gz` is a valid non-empty gzip and the manifest contains no DB password, S3 secret/access key or auth secrets beyond the intentionally copied protected `.env` file.
- [ ] Verify `.env`, `package.json`, `package-lock.json`, local `extensions/` and configured local Files root are captured exactly when present and recorded as absent when they did not exist.
- [ ] Verify a corrupt/truncated/empty database dump is rejected by restore **before** any table/view is dropped.
- [ ] Remove an asset that `manifest.json` declares (for example `project/package.json` or `files/`) and verify restore fails with `BACKUP_ASSET_MISSING` before destructive DB reset.
- [ ] Add an extra table and view after taking the backup, then run restore into the disposable DB; verify reset drops both, the dump recreates only backup-state objects, FK checks are restored, and schema/data matches the snapshot.
- [ ] Compare representative row counts/data checksums and schema definitions before backup vs after restore rather than only checking that commands exit zero.
- [ ] Verify restore refuses a different DB host/port/name by default with `BACKUP_DATABASE_TARGET_MISMATCH` and does not even start destructive validation/reset.
- [ ] Restore an intentional source backup into a different disposable recovery DB with `--allow-different-database-target`; verify the recovery DB receives the data **and the current recovery `.env` is preserved**, so the app does not reconnect to the source DB afterward.
- [ ] Exercise DB SSL/TLS with the actual production-compatible MySQL client and verify `--ssl-mode=REQUIRED` works in that environment.
- [ ] Run backup/restore with a realistically large DB and local Files tree to confirm streaming behavior stays memory-bounded and preflight disk estimates include DB + local Files/extensions/project metadata + headroom.

### Partial DDL / migration recovery

- [ ] In a disposable DB introduce a test migration containing at least two DDL statements and force the second statement to fail after the first has committed implicitly; verify `yuncms_schema_migration_attempts` records `failed` with the completed statement index.
- [ ] Immediately rerun bootstrap and verify it returns `DATABASE_MIGRATION_RECOVERY_REQUIRED` without re-executing the already-applied first statement.
- [ ] Restore the pre-update backup and verify both the partial DDL object and failed-attempt journal state disappear with the restored database snapshot.
- [ ] Kill the migration process hard while an attempt is `applying`; on the next bootstrap verify the stale applying attempt also fails closed instead of blind retrying.

### Running-service and concurrency guards

- [ ] While YunCMS is running, verify `yuncms backup`, destructive `yuncms restore ... --yes`, and real `yuncms update` refuse to mutate/snapshot state with `UPDATE_APPLICATION_RUNNING`.
- [ ] Test `HOST=127.0.0.1`, `HOST=0.0.0.0`, `HOST=::` and the actual production bind address so the service-running guard reaches the configured local process correctly.
- [ ] With a real auto-restarting supervisor (systemd/PM2/Docker/Plesk), stop only the child process and prove the supervisor restart is caught before backup/migration/destructive restore; then stop the supervisor itself and confirm the update can proceed.
- [ ] Start two real update/restore commands for the same project concurrently; the second must fail with `UPDATE_ALREADY_RUNNING` while the first holds the OS-temp lock.
- [ ] Hard-kill an update process, verify the stale lock remains, then confirm the reported lock can be manually removed **only after** verifying no update/restore/npm/mysql/mysqldump process remains.
- [ ] Verify two different project paths get different operation locks and do not block one another.

### Successful managed update

- [ ] Publish/install two disposable YunCMS versions with a real migration difference and update from the older project to the newer one using `yuncms update --to <version>`.
- [ ] Confirm the mandatory backup exists and verifies before `npm install` modifies package files.
- [ ] Confirm package.json/package-lock resolve the exact requested YunCMS target and bootstrap is executed through the **newly installed** CLI, not the old globally/npx-cached code.
- [ ] Confirm target migrations apply exactly once and the target runtime reaches `/ready` in the temporary verification process.
- [ ] Confirm the temporary verification runtime terminates cleanly and production is **not** silently left running outside the configured supervisor; start the normal supervisor manually and verify health/ready/Studio/API afterward.
- [ ] Repeat with an extension installed and verify extension startup compatibility is exercised by the temporary runtime probe.
- [ ] From an older release that does not yet contain the `update` command, verify first transition using `npx --yes @yunsoft/yuncms@<new> update --to <new>` after the new CLI is actually published.

### Automatic rollback

- [ ] Force target package installation to fail after the backup exists; verify automatic rollback restores project package files/DB/files/extensions and reinstalls the old dependency graph.
- [ ] Force the target migration to fail after a partial DDL change; verify automatic rollback resets current DB objects, restores the old dump, restores package/files/extensions/env, runs `npm ci` when the old lockfile existed and verifies the old runtime via `/ready`.
- [ ] Force the new runtime or an installed extension to fail during startup after successful migration; verify the same full rollback executes and the old runtime readiness probe passes.
- [ ] After a successful rollback confirm the CLI still returns the **original update error** with `rollbackPerformed=true` and preserves the backup path for inspection.
- [ ] Independently force rollback restore, old dependency reinstall or old runtime probe to fail; verify the final error becomes `UPDATE_ROLLBACK_FAILED`, contains both update/rollback failure context and leaves the backup directory untouched for manual recovery.
- [ ] Force the supervisor to restart the API immediately before rollback destructive reset; verify `beforeDestructive` prevents resetting a live DB and rollback fails closed rather than modifying live state.

### S3 / external storage

- [ ] With real S3-compatible storage configured, verify `yuncms update` blocks without explicit acknowledgement because YunCMS does not copy bucket objects into the local backup.
- [ ] Enable and test provider-side object versioning/snapshot/replication recovery first; only then run the update with `--allow-unverified-s3` and verify metadata/package rollback plus provider-side object recovery form a complete recovery plan.
- [ ] Confirm `manifest.json` records the S3 bucket identifier but never stores access credentials and never claims `objectsBackedUp=true`.

## 16. Final release decision

- [ ] Only after applicable checks above, including the managed upgrade/rollback release gate, are removed as successfully completed should this exact source state be called deployment-verified production ready.
