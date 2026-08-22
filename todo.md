# Environment / Execution TODO

This file contains **only verification that cannot be completed from the current GitHub-only environment**. Source implementation work belongs in `plan.md`.

Branch baseline: `22-08-2026`.

The current assistant execution container cannot resolve `github.com`/reach the npm registry, so the commands below were **not** claimed as executed. Remove a checklist item when it passes; do not keep completed `[x]` history here.

## 1. Release blocker — regenerate dependency lock and execute the source suite

`packages/api/package.json` now contains the MCP and external-auth runtime dependencies, while the checked-in `package-lock.json` predates them. Do not hand-edit the lockfile.

Run from a clean checkout:

```bash
git checkout 22-08-2026
git pull --ff-only
node --version
npm --version
npm install --package-lock-only --ignore-scripts
npm ci
npm run build
npm run test:fast
npm test
npm run test:release
git status --short
```

Required versions:

```text
Node.js 24.x
npm 11+
```

- [ ] Commit the generated `package-lock.json` after confirming it includes the exact declared API dependencies: `@modelcontextprotocol/node@2.0.0`, `@modelcontextprotocol/server@2.0.0`, `@node-saml/node-saml@5.1.0`, `ldapts@9.0.0`, `openid-client@6.8.7`, and `zod@4.4.3`.
- [ ] `npm ci` succeeds from the committed lockfile without modifying it.
- [ ] `npm run build` passes.
- [ ] `npm run test:fast` passes.
- [ ] `npm test` passes.
- [ ] `npm run test:release` passes.
- [ ] Re-run `git status --short`; only intentional local evidence/env files may remain.

If a pinned dependency API differs from the source assumptions, fix source/tests and regenerate the lock rather than weakening tests.

## 2. Real MySQL 8 migration and query gate

Use a disposable MySQL 8-compatible database whose name clearly contains `test`, `ci`, or `dev`.

- [ ] Bootstrap a fresh empty DB and verify migrations `0001` through `0013-external-auth-foundation` apply exactly once and compatibility succeeds after restart.
- [ ] Upgrade a representative pre-0013 database and verify `0013` creates `yuncms_auth_identities` and `yuncms_auth_transactions` without changing existing users/sessions/permissions.
- [ ] Verify `(provider, subject)` uniqueness, one-time/expiring auth transactions and replay rejection.
- [ ] Seed a 3–4 hop M2O/O2O graph and verify nested fields such as `author_id.company_id.country_id.name` respect source/target field allowlists and row filters at every hop.
- [ ] Create reverse O2M data and verify the virtual reverse alias returns only permission-visible child rows as an array.
- [ ] Create a managed M2M junction and verify the virtual target alias returns target records rather than leaking junction rows.
- [ ] Remove read permission from the M2M junction and confirm M2M expansion fails closed rather than using the junction as an authorization bypass.
- [ ] Exercise the to-many row cap and relation/query-cost limits with oversized data; requests must fail with bounded query errors before unbounded materialization.
- [ ] Verify `search`, aggregate and `groupBy` results exclude permission-hidden rows/fields.
- [ ] Run representative `docs/api-query-language.md` examples against MySQL and correct documentation if runtime behavior differs.

Relational filter/sort/`deep` options listed in `plan.md` remain source follow-ups; do not mark them implemented from this gate.

## 3. Shared Redis / multi-process gate

Run **two independent YunCMS API processes** against the same MySQL and Redis instance.

Recommended test configuration:

```env
CACHE_STORE=redis
API_RATE_LIMIT_STORE=redis
AUTH_RATE_LIMIT_STORE=redis
REDIS_URL=redis://127.0.0.1:6379
REDIS_PREFIX=yuncms:integration:
REDIS_REQUIRED=true
```

- [ ] A permission decision cached through process A is reused safely; changing/removing the permission invalidates the Redis generation and process B observes the new decision without a stale authorization grant.
- [ ] Public Files permission grant/removal propagates across both processes.
- [ ] Requests split between A/B consume one shared API rate-limit budget.
- [ ] Login/action requests split between A/B consume one shared auth rate-limit budget.
- [ ] Redis key namespaces do not collide between different `REDIS_PREFIX` values.
- [ ] No raw bearer token, password or raw email is present in Redis rate-limit keys.
- [ ] Restart Redis during ordinary authorization with `REDIS_REQUIRED=false`; service degrades safely and never grants access because Redis failed.
- [ ] Repeat with `REDIS_REQUIRED=true`; readiness becomes not-ready while required shared state is unavailable.
- [ ] If production uses TLS/ACL Redis, verify `rediss://` credentials and confirm logs never expose Redis secrets.

## 4. Extension event and scheduler gate

Use a disposable hook extension plus real MySQL.

- [ ] Collection/field/M2O/O2O/M2M schema changes emit their specific post-success event and then `schema.changed` only after successful lifecycle completion.
- [ ] Force a schema failure/compensation path and verify no success event is emitted.
- [ ] Verify five-field cron matching, no duplicate execution within one minute and overlap policy=`skip`.
- [ ] A job cannot register without explicit `accountability: 'system'`.
- [ ] Run two API processes with the same singleton job and verify exactly one obtains the hashed MySQL advisory lock for each due execution.
- [ ] Use maximum-length extension/job identifiers and confirm advisory-lock names stay within MySQL's limit.
- [ ] Start a long job, send SIGTERM and verify new runs stop while shutdown honors the scheduler/server budgets.

## 5. External authentication provider matrix

Use non-production test tenants/directories. Never commit provider client secrets, bind passwords or certificates.

### OIDC

- [ ] Test Authorization Code + PKCE against a real OIDC provider.
- [ ] Tampered issuer/audience/signature/expiry/`state`/nonce and replay all fail closed.
- [ ] Provider tokens never become YunCMS bearer credentials; success returns ordinary local YunCMS session/access/refresh tokens.

### OAuth2

- [ ] Test configured authorization/token/userinfo endpoints and both supported client-auth modes where practical.
- [ ] Invalid `state`, failed token exchange, non-JSON userinfo and missing stable subject fail closed.

### LDAP / Active Directory

- [ ] Test default `entryUUID` subject mapping.
- [ ] Test `AUTH_PROVIDER_<ID>_SUBJECT_ATTRIBUTE=objectGUID` against Active Directory; binary GUID normalization remains stable across logins.
- [ ] Rename/move a directory entry and confirm the stable subject preserves the YunCMS identity link.
- [ ] Plain `ldap://` remains rejected unless the explicit insecure-development override is enabled; production uses LDAPS/TLS.

### SAML

- [ ] Test signed SAML response/assertion validation with a real IdP test application.
- [ ] `InResponseTo`/RelayState replay and expired request IDs are rejected.
- [ ] Invalid signature/issuer/assertion state fails closed.

### Linking / provisioning / Studio

- [ ] Default unlinked identity policy cannot take over an existing same-email YunCMS account.
- [ ] JIT provisioning assigns only the configured existing non-admin/non-Public role.
- [ ] Verified-email linking works only when explicitly enabled; automatic Administrator linking remains separately guarded.
- [ ] `/auth/providers` exposes only public metadata, never secrets/certificates/bind passwords.
- [ ] Browser OIDC/OAuth/SAML login returns a short-lived one-time `auth_code`; Studio exchanges it, removes it from the URL and stores only the YunCMS session.
- [ ] LDAP Studio login does not expose service bind credentials.
- [ ] Test split-origin development (`VITE_API_URL`) and production same-origin deployment; callback/handoff lands on the intended Studio path without an open redirect.

## 6. MCP 2026-07-28 / real client gate

After regenerating the lockfile, use an MCP v2 client against `POST /mcp`.

Start read-only:

```env
MCP_ENABLED=true
MCP_WRITES_ENABLED=false
MCP_REQUIRE_AUTHENTICATION=true
MCP_ALLOWED_HOSTS=localhost:3008
MCP_ALLOWED_ORIGINS=http://localhost:3008
MCP_MAX_ITEMS=100
MCP_MAX_RESULT_BYTES=1000000
```

- [ ] Trusted Host + valid YunCMS session/API token can initialize and call all four read tools.
- [ ] Missing/wrong Host is rejected with `MCP_HOST_FORBIDDEN`, including non-browser requests without Origin.
- [ ] Wrong browser Origin is rejected with `MCP_ORIGIN_FORBIDDEN`.
- [ ] Unauthenticated access is rejected while authentication is required.
- [ ] `schema.list_collections` exposes only readable collections.
- [ ] `schema.describe_collection` hides unreadable fields and derives action capability from the permission engine.
- [ ] `items.read_many`/`items.read_one` preserve row filters, field allowlists, relation RBAC and query limits.
- [ ] Oversized serialized results return bounded `MCP_RESULT_TOO_LARGE`.
- [ ] With writes disabled, create/update/delete tools are not registered.
- [ ] Enable writes only in a disposable environment and verify create/update/delete preserve caller accountability, validation, hooks and audit.
- [ ] A least-privilege non-admin API token cannot exceed its equivalent REST permissions through MCP.
- [ ] Behind the real reverse proxy, configure `MCP_ALLOWED_HOSTS` to the forwarded public Host; arbitrary Host values remain rejected.

## 7. Core browser / security smoke

- [ ] Fresh `yuncms init` produces `PORT=3008`, `STUDIO_ORIGIN=http://localhost:3008`, `AUTH_PUBLIC_URL=http://localhost:3008`; built Studio and API share one listener.
- [ ] Public Files is deny-by-default; explicit unfiltered grant, filtered grant and removal behave identically for list/read/content and never read a forbidden storage object.
- [ ] Delegated Roles/Users permissions never permit Administrator/Public escalation, Administrator mutation or protected/in-use role deletion.
- [ ] Genuine PDF/PNG/JPEG/GIF/WebP uploads succeed; mismatched declared MIME/signature is rejected before storage metadata commit.
- [ ] Image/PDF/video/audio previews work after access-token refresh and gallery thumbnails use contain-style rendering.
- [ ] Dark/Light smoke Content, Files, Users, Data Model, Roles & Permissions and Branding; no hard-coded light surfaces or raw localization keys.
- [ ] Logo/favicon Files modal remains searchable/paginated and selected assets fall back after file deletion.
- [ ] Natural Turkish display names keep stable API/MySQL keys when labels change later.
- [ ] Bounded custom fields can be added to Users/Files/Roles while non-schema-managers/internal system collections remain blocked.
- [ ] Behind actual TLS proxy verify exact `TRUST_PROXY_HOPS`, client-IP bucketing and HTTPS-only HSTS.
- [ ] If S3-compatible storage is used, verify upload/list/content/delete/reconciliation/branding against the real provider with redacted errors.

## 8. Managed backup / restore / update release gate

Follow `docs/codex-managed-upgrade-verification.md` in a disposable Node 24 + MySQL environment. GitHub Actions are not part of this gate.

- [ ] Run `npm run test:upgrade:mysql` against the documented disposable DB setup.
- [ ] Run `yuncms backup` with service stopped; validate non-empty gzip dump and format-2 SHA-256 manifest without secret leakage outside the intentionally protected `.env` copy.
- [ ] Corrupt/truncate the dump or a declared managed asset and verify restore fails **before** destructive DB reset.
- [ ] Restore after adding extra tables/views and verify exact backup-state restoration, including removal of objects absent from the backup.
- [ ] Verify DB target mismatch refusal and the explicit different-target recovery override.
- [ ] Exercise update dry-run, same-version DB drift, compatible upgrade, incompatible migration history, readiness probe, rollback, rollback failure and bounded TERM/KILL paths.
- [ ] Verify project maintenance lock and MySQL advisory lock prevent concurrent destructive commands.
- [ ] Under the maintenance-window model, stop **all** API replicas sharing DB/storage before destructive backup/update/restore. Distributed online maintenance remains a source follow-up in `plan.md`.

## Completion rule

Do not call this branch deployment-verified until section 1 is green and the environment-specific sections relevant to the intended deployment have been executed with evidence.

Do not use GitHub Actions as a substitute for these checks; run them explicitly in the intended Node/MySQL/provider environment.
