# Environment / Execution TODO

This file contains **only verification that still requires deployment infrastructure, provider credentials or an exact Node/browser/multi-process/proxy environment**. Source implementation work belongs in `plan.md`.

Branch baseline: `22-08-2026`.

Remove a checklist item when it passes; do not keep completed `[x]` history here.

## 1. Yapay Zeka runtime / browser gate

- [ ] Verify the Studio sidebar and page present the feature only as **Yapay Zeka** (or **AI** in English), including mobile navigation, light theme and dark theme; no external companion application is required.
- [ ] With a limited non-admin user, ask Yapay Zeka to inspect both an allowed and a forbidden collection. Allowed schema/data must work and forbidden data must remain inaccessible through the same RBAC boundaries as REST.
- [ ] With persisted assistant writes enabled, verify every chat starts **Salt okunur**. In **Otomatik yazma**, create/update may run without another approval while delete remains unavailable. In **Tam yetki (silme dahil)**, delete becomes available only for the current message. All modes must still obey the current user's row/field/action permissions and normal validation/hooks/audit behavior.
- [ ] Verify a conversation longer than `AI_MAX_HISTORY` continues normally using the bounded recent history instead of failing with an oversized-history request.
- [ ] Verify provider timeout/failure and the unconfigured-provider state produce bounded user-facing errors without raw provider bodies, stack traces, tokens or database details.
- [ ] Review the chosen provider's data-retention/privacy terms before enabling it for sensitive production data; chat text and bounded YunCMS data needed to answer requests may be sent to that provider.

## 2. Shared Redis / multi-process gate

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

- [ ] If production uses TLS/ACL Redis, verify `rediss://` credentials and confirm logs never expose Redis secrets.

## 3. External authentication provider matrix

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

## 4. MCP deployment edge gate

Use an MCP v2 client against `POST /mcp` for external integrations that need the protocol endpoint.

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

- [ ] Behind the real reverse proxy, configure `MCP_ALLOWED_HOSTS` to the forwarded public Host; arbitrary Host values remain rejected.

## 5. Core browser / security smoke

- [ ] Delegated Roles/Users permissions never permit Administrator/Public escalation, Administrator mutation or protected/in-use role deletion.
- [ ] Image/PDF/video/audio previews work after access-token refresh and gallery thumbnails use contain-style rendering.
- [ ] Logo/favicon Files modal remains searchable/paginated and selected assets fall back after file deletion.
- [ ] Natural Turkish display names keep stable API/MySQL keys when labels change later.
- [ ] Bounded custom fields can be added to Users/Files/Roles while non-schema-managers/internal system collections remain blocked.
- [ ] Behind actual TLS proxy verify exact `TRUST_PROXY_HOPS`, client-IP bucketing and HTTPS-only HSTS.
- [ ] If S3-compatible storage is used, verify upload/list/content/delete/reconciliation/branding against the real provider with redacted errors.

## 6. Managed backup / restore / update release gate

Follow `docs/codex-managed-upgrade-verification.md` in a disposable Node 24 + MySQL environment. GitHub Actions are not part of this gate.

- [ ] Exercise update dry-run, same-version DB drift, compatible upgrade, incompatible migration history, readiness probe, rollback, rollback failure and bounded TERM/KILL paths.
- [ ] Under the maintenance-window model, stop **all** API replicas sharing DB/storage before destructive backup/update/restore. Distributed online maintenance remains a source follow-up in `plan.md`.

## Completion rule

Do not call this branch deployment-verified until the environment-specific sections relevant to the intended deployment have been executed with evidence.

Do not use GitHub Actions as a substitute for these checks; run them explicitly in the intended Node/MySQL/provider environment.
