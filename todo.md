# Environment / Manual TODO

Only checks that still require a specific production-compatible server, an actual deployment provider, or manual browser interaction belong here. This file is a **pending verification list**: completed checks are removed, never kept as `[x]` history.

## 1. Exact production database gate

The Node 24 fast/full/release gates and the destructive real-database integration suite passed locally against the disposable `yuncms_codex_test` database on XAMPP MariaDB 10.4. Before declaring an actual deployment production-ready, repeat the same release command against the exact supported MySQL 8-compatible server/version selected for that deployment:

- [ ] Run `DB_HOST=... DB_PORT=3306 DB_DATABASE=yuncms_release_test DB_USER=... DB_PASSWORD='...' YUNCMS_TEST_MYSQL=1 YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 npm run test:release` on Node 24. The disposable database name must contain `test`, `ci` or `dev`.
- [ ] Verify the production database account has only the intended runtime/schema privileges and complete a real backup/restore rehearsal.

## 2. Remaining manual Studio checks

Automated/source checks and the local browser smoke already cover login, fresh init/port 3008, default accountability fields, physical timestamp/FK definitions, actor stamping/nulling, protected system fields, field groups, Decimal/Timestamp/File/Image creation, file-library selection, authenticated image previews, Content file columns, Public/custom-role matrix rendering, EN/TR key leakage, dark surfaces, sidebar collapse and a 390 px narrow layout. The following interaction checks still need a human pass:

- [ ] In the local `yuncms_fresh_init_test` Studio, grant a disposable custom role `Users: Read` without `Roles: Read`; verify the Users screen loads without leaking role UUIDs. Then add `Roles: Read` and verify role names/selectors appear. Exercise delegated Users create/update/delete and confirm Administrator/Public assignment, Administrator mutation/deletion and another user's password change remain blocked.
- [ ] Exercise selective Files read/create/update/delete permissions and confirm Roles remains read-only. Confirm Users/Files/Roles stay action-only and generic `/items/yuncms_users` / `/items/yuncms_files` access remains blocked.
- [ ] Use the browser's native `datetime-local` picker to create a fixed Date & time default and inspect MySQL for `YYYY-MM-DD HH:MM:SS` storage. The pure payload regression and the normalized API/MySQL path pass, but the in-app automation driver cannot commit a value to this native segmented control.
- [ ] Create and delete O2O relations through Studio for `RESTRICT`, `CASCADE` and optional-field `SET NULL`; confirm the UI summary stays aligned with the real FK + UNIQUE lifecycle. Real integration already covers uniqueness, duplicate rejection, `SET NULL` creation and relation deletion; source tests cover required-field rejection.
- [ ] Upload a file directly from a Content File/Image control and verify immediate selection, persistence and optional clear. Existing-library image selection and authenticated image previews are verified.
- [ ] Upload representative PDF, video, audio and unsupported files and manually confirm embedded/playable/placeholder behavior. Their classifier/component contracts are covered by automated tests.
- [ ] Finish a keyboard/screen-reader pass for visible focus, Escape/modal behavior, accordion controls, type cards, checkboxes and labels; visually sample the remaining Login, Users, Relations and Content Visibility surfaces in both Light and Dark themes.

## 3. Deployment-only hardening

- [ ] Behind the actual reverse proxy, configure exact `TRUST_PROXY_HOPS`; verify session IP and auth rate-limit buckets use the intended client IP. Confirm `TRUST_PROXY_HOPS=0` ignores forwarded addresses for direct deployments.
- [ ] Configure HSTS at the actual TLS/reverse-proxy layer and verify it there.
- [ ] If production uses S3-compatible storage, test the real provider: upload/list/download/delete, credential-chain behavior, reconciliation dry-run/age guard, multi-page inventory and redacted provider errors.

## 4. Final production-readiness decision

- [ ] Only after the applicable checks above pass, update the production-readiness decision for the actual deployment environment.
