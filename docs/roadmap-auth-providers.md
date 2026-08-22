# Authentication Provider Roadmap — OIDC, OAuth2, LDAP and SAML

Status: design/roadmap only. This document does not claim external identity-provider support is implemented.

Target branch baseline: `22-08-2026`.

## Purpose

YunCMS already has a solid local authentication foundation:

- local email/password login;
- scrypt password hashing;
- short-lived opaque access tokens;
- rotating refresh tokens;
- server-side sessions;
- static API tokens;
- password reset;
- email verification;
- logout/logout-all/session revocation;
- explicit accountability resolved from the current user/role.

The remaining major authentication gap versus mature platforms such as Directus is provider breadth.

This roadmap defines how YunCMS should add:

1. OpenID Connect (OIDC);
2. OAuth 2.0 provider login where OIDC is not available;
3. LDAP/Active Directory authentication;
4. SAML 2.0 SSO.

Reference behavior to study during implementation:

- Directus authentication/provider documentation: https://directus.com/docs/guides/auth/sso
- Directus authentication fundamentals: https://directus.com/docs/guides/auth/authentication

The goal is not to replace YunCMS sessions with provider tokens. External identity proves who the user is; after successful provider authentication YunCMS should issue its normal local session/access/refresh credentials so the rest of the application keeps one accountability model.

## Core principle

All authentication methods must converge to the same internal identity:

```text
Local password / OIDC / OAuth2 / LDAP / SAML
                    |
                    v
             YunCMS user
                    |
                    v
          YunCMS role/accountability
                    |
                    v
       YunCMS session/access token
```

RBAC must not care which authentication provider was used.

## Current baseline

Current local authentication remains the default and must not regress.

External-provider support should be additive:

```text
AUTH_PROVIDERS=local,google,company_oidc
```

Exact configuration names may change, but the architecture should support multiple named providers of the same driver type.

Examples:

```text
provider id: google
provider driver: oidc

provider id: azure
provider driver: oidc

provider id: company_ldap
provider driver: ldap
```

Provider IDs become stable configuration/identity keys and must be validated with the same care as extension IDs.

## User identity model

Do not put all provider-specific identity state directly on `yuncms_users`.

Introduce a dedicated identity table conceptually like:

```text
yuncms_auth_identities
----------------------
id
user
provider
provider_subject
provider_email
provider_data
created_at
updated_at
last_login_at
```

Required uniqueness:

```text
UNIQUE(provider, provider_subject)
```

A single YunCMS user may have more than one linked identity.

Examples:

```text
user A -> local password
user A -> google OIDC subject 123
user A -> company SAML NameID abc
```

Do not use email address alone as the immutable provider identity. OIDC `sub`, SAML persistent NameID/explicit mapped ID, or LDAP stable directory identifier should be preferred.

## Account linking safety

This is one of the highest-risk parts of SSO.

Default rule:

**Never link an external login to an existing YunCMS account solely because the email strings match.**

Otherwise an incorrectly configured/untrusted provider that asserts `admin@example.com` could take over an existing admin account.

Supported policies should be explicit.

### Policy A — Existing link only

Safest default.

- external subject must already be linked to a YunCMS user;
- otherwise login fails with a generic account-not-provisioned response.

### Policy B — JIT provisioning

Optional per provider.

- provider identity may create a new YunCMS user;
- assign only a configured non-admin default role;
- never assign Administrator/Public automatically;
- email must satisfy provider-specific verification requirements where available;
- generated user must still pass YunCMS user invariants.

### Policy C — Verified-email linking

Only if explicitly enabled by operator.

Requirements should include:

- trusted provider allowlist;
- provider asserts email as verified;
- matching YunCMS user is not Administrator unless an even stricter admin-link policy is enabled;
- optional user/admin confirmation step before permanent linking.

This policy should not be the default.

## Provider registry

Use a driver registry rather than hard-coding Google/Azure/etc. into auth routes.

Conceptual driver contract:

```js
{
  id,
  type,
  beginLogin(context),
  handleCallback(context),
  resolveIdentity(result),
  shutdown?()
}
```

Different protocols need different methods, so the exact interface may use protocol-specific adapters, but provider discovery/configuration should be centralized.

The provider result should normalize to something like:

```js
{
  subject: 'provider-stable-id',
  email: 'user@example.com',
  emailVerified: true,
  displayName: 'User Name',
  claims: {...}
}
```

Only bounded/allowlisted provider data should be persisted.

Do not store entire large ID tokens/assertions indefinitely by default.

## Shared auth flow

After external provider success:

1. validate provider response cryptographically/protocol-correctly;
2. normalize external identity;
3. resolve existing identity link or apply configured provisioning policy;
4. verify YunCMS user is active;
5. resolve current YunCMS role;
6. create a normal YunCMS server-side session;
7. issue normal `yca_` access + `ycr_` refresh credentials;
8. update identity `last_login_at`;
9. emit redacted auth lifecycle event when extension event roadmap is implemented.

Provider access/ID tokens should not become YunCMS bearer credentials.

## Browser flow state

OIDC/OAuth/SAML browser flows need temporary transaction state.

Introduce one-time short-lived auth transaction storage containing only required state:

```text
yuncms_auth_transactions
------------------------
id/hash
provider
state_hash
nonce_hash or value as protocol requires
pkce_verifier encrypted/appropriately protected if stored
redirect_target
created_at
expires_at
used_at
```

Alternatively, signed/encrypted stateless state may be considered, but server-side one-time state fits YunCMS's existing opaque-token philosophy and makes replay invalidation explicit.

Rules:

- high-entropy random `state`;
- store only hash where equality verification is enough;
- one-time consumption;
- short expiry, e.g. 5–10 minutes;
- bounded cleanup;
- redirect target must be validated against trusted application origins/paths;
- never allow arbitrary post-login open redirects.

## Phase A1 — OpenID Connect first

OIDC should be the first external provider protocol because modern Google/Microsoft/Keycloak/Auth0/Okta-style deployments commonly support it and it has a standardized identity layer.

### Required OIDC features

- Authorization Code flow;
- PKCE where supported/appropriate;
- `state` validation;
- `nonce` validation;
- issuer validation;
- audience/client ID validation;
- signature validation through provider JWKS;
- token expiry/time validation;
- HTTPS issuer requirement except explicit local-development exception;
- discovery document support;
- exact configured callback URI;
- normalized `sub` as provider subject;
- verified email claim handling only according to configured policy.

Do not implement implicit flow.

### Example configuration shape

Conceptually:

```text
AUTH_PROVIDERS=local,company
AUTH_COMPANY_DRIVER=oidc
AUTH_COMPANY_ISSUER_URL=https://id.example.com
AUTH_COMPANY_CLIENT_ID=...
AUTH_COMPANY_CLIENT_SECRET=...
AUTH_COMPANY_SCOPES=openid profile email
AUTH_COMPANY_JIT_PROVISION=false
AUTH_COMPANY_DEFAULT_ROLE=...
```

Secrets must never be returned through Studio settings APIs or logs.

### OIDC token handling

The provider ID token/access token is only part of the login exchange.

YunCMS should not persist refresh tokens from the provider unless a concrete downstream API-use feature requires them later.

Authentication-only integration can discard provider access/refresh tokens after identity resolution.

This dramatically reduces secret-retention risk.

## Phase A2 — Generic OAuth 2.0

OAuth2 by itself is authorization, not a standardized identity protocol. Therefore generic OAuth login requires a configured user-info mapping.

Support it only for providers that do not provide OIDC.

Required configuration concept:

```text
AUTH_VENDOR_DRIVER=oauth2
AUTH_VENDOR_AUTHORIZE_URL=...
AUTH_VENDOR_TOKEN_URL=...
AUTH_VENDOR_USERINFO_URL=...
AUTH_VENDOR_CLIENT_ID=...
AUTH_VENDOR_CLIENT_SECRET=...
AUTH_VENDOR_SUBJECT_PATH=id
AUTH_VENDOR_EMAIL_PATH=email
```

Security requirements:

- Authorization Code flow;
- PKCE when possible;
- state validation;
- TLS;
- strict endpoint configuration;
- allowlisted mapping paths;
- no arbitrary executable mapping expressions;
- stable subject is mandatory;
- email alone is insufficient.

Avoid adding dozens of provider-specific code paths. Named presets may populate generic OAuth/OIDC configuration but should use the same drivers.

## Phase A3 — LDAP / Active Directory

LDAP differs from browser redirect SSO. YunCMS receives username/password and validates them against directory infrastructure.

### Authentication approach

Recommended pattern:

1. connect/bind using configured service account if directory search is needed;
2. find directory entry using a safely parameterized/escaped filter;
3. bind as the discovered user using the submitted password;
4. resolve stable directory identifier + mapped attributes;
5. map/link/provision YunCMS user;
6. immediately discard plaintext password;
7. issue ordinary YunCMS session tokens.

Do not store LDAP passwords.

### Configuration considerations

- `ldap://` with StartTLS or `ldaps://`;
- configurable CA certificate/trust options without insecure defaults;
- connection/bind/search timeouts;
- base DN;
- bind DN/secret;
- user filter template with safe placeholder escaping;
- stable ID attribute (`entryUUID`, objectGUID or deployment-specific equivalent);
- email/name attribute mappings;
- optional group-to-role mapping.

### Group-to-role mapping

This is useful but dangerous.

Rules:

- mapping configuration explicitly names allowed YunCMS role IDs;
- Administrator role mapping disabled by default;
- Public role can never be assigned to authenticated users;
- ambiguous multiple-role matches use deterministic configured priority or deny;
- role changes should take effect on next authentication and/or current session authorization should still resolve current DB role according to existing YunCMS semantics.

## Phase A4 — SAML 2.0

SAML adds substantial XML/signature complexity and should come after OIDC/LDAP foundations are stable.

Required scope:

- Service Provider initiated login first;
- signed assertions/responses according to provider requirements;
- issuer/entity ID validation;
- audience validation;
- destination/ACS URL validation;
- assertion time-window validation;
- replay protection;
- configurable stable subject/NameID mapping;
- email/name attribute mappings;
- metadata import/export if practical;
- certificate rollover strategy;
- optional IdP-initiated login only after explicit threat-model review.

Do not hand-roll XML signature verification. Use a mature maintained SAML library and pin/test it carefully.

### SAML replay protection

Store recently consumed assertion IDs or one-time transaction identifiers with expiry so the same valid signed assertion cannot simply be replayed.

For multi-instance deployments this temporary replay state must be shared or authoritative in MySQL/Redis rather than per-process only.

## Provider configuration management

### Environment first

Secrets should be configured by environment/deployment tooling initially.

Benefits:

- no need to build encrypted secret-at-rest settings UI immediately;
- aligns with existing deployment model;
- avoids exposing client secrets through Studio APIs.

Later Studio support may manage non-secret provider metadata while secrets remain env/provider secret store.

### Validation at startup

Fail fast for malformed configured providers:

- duplicate provider IDs;
- missing required URLs/client IDs;
- invalid callback base URL;
- unsupported driver;
- default role missing/Administrator/Public when JIT configuration forbids it;
- insecure provider URL in production;
- invalid LDAP filter template;
- invalid SAML certificate/config.

A provider that is listed as enabled but cannot be initialized should normally fail startup/readiness rather than disappearing silently from the login screen.

## API surface

Conceptual endpoints:

```text
GET  /auth/providers
GET  /auth/login/:provider
GET  /auth/callback/:provider
POST /auth/login/:provider        # protocol-specific for LDAP/local-style credential exchange
```

`GET /auth/providers` returns only public provider metadata required by clients:

```json
{
  "id": "company",
  "type": "oidc",
  "label": "Sign in with Company",
  "login_url": "/auth/login/company"
}
```

Never return client secrets, bind passwords, private keys or raw internal config.

## Studio login UX

Login screen should render provider buttons from `/auth/providers`.

Rules:

- local login remains available unless explicitly disabled;
- provider label/icon can be configured safely;
- failed provider login returns generic user-facing message plus request ID;
- sensitive protocol error stays in redacted server logs;
- callback route should return/redirect to Studio without placing YunCMS access/refresh tokens into ordinary query-string history if avoidable.

Prefer secure cookie/one-time exchange patterns for browser handoff rather than exposing long-lived credentials in URLs.

## Local authentication disablement

Enterprise deployments may want SSO-only accounts.

Do not add a global "disable local auth" toggle without recovery planning.

Recommended rules:

- always preserve documented break-glass administrator strategy;
- support per-user/provider restrictions later;
- if local login can be globally disabled, CLI/recovery procedure must be documented and tested;
- API tokens must have explicit independent policy;
- disabling password login must not accidentally disable password reset endpoints in a confusing half-state—routes should reflect configured capability.

## Session and logout behavior

YunCMS logout should always revoke the YunCMS session.

External provider logout is separate.

Initial scope:

- local YunCMS logout only;
- optional provider end-session redirect for OIDC when explicitly configured;
- do not promise global IdP logout/SAML SLO until fully implemented/tested.

A user being disabled in YunCMS must invalidate/deny future use regardless of provider account state.

## Role/accountability behavior

Provider authentication never grants permissions directly.

Permissions remain:

```text
external identity -> yuncms_users row -> current role -> PermissionsService
```

No provider claim should be passed directly into `accountability.admin=true`.

Even group/role mappings must update/resolve a normal YunCMS role and pass protected-role checks.

## Security requirements

### Common

- TLS for external providers in production;
- strict redirect URI allowlisting;
- CSRF state validation;
- replay protection;
- one-time short-lived auth transactions;
- no provider secret logging;
- no raw tokens in audit payloads;
- generic public auth errors;
- per-provider + IP rate limits;
- clock-skew bounds for signed token/assertion validation;
- stable provider subject, not mutable display/email only;
- JIT default role cannot be Administrator/Public;
- user must be active at session issue time;
- existing protected-admin invariants remain service-enforced.

### SSRF/provider URL risk

Provider discovery/token/user-info URLs cause server-side outbound requests.

Configuration is trusted operator input, but production hardening should still consider:

- HTTPS requirement;
- no redirects to unexpected schemes;
- DNS/private-network policy if provider config can ever become remotely editable;
- bounded connect/read timeouts;
- bounded response sizes;
- content-type/JSON validation.

If provider config remains environment-only/admin deployment config, threat exposure is much lower than user-supplied URLs.

## Multi-instance requirements

External auth transaction/replay state must work across replicas.

Options:

1. store transaction state in MySQL;
2. store ephemeral state in Redis when shared-state roadmap is active.

Do not keep `state`/nonce/SAML replay records only in process memory if callback may arrive at another replica.

The simplest correctness-first design is MySQL-backed auth transactions initially; Redis can later optimize/host ephemeral replay state with a strict shared-store requirement for provider flows.

## Audit/extension events

Add redacted events when extension event roadmap lands:

```text
auth.provider.login.success
auth.provider.login.failed
auth.identity.linked
auth.identity.created
```

Audit fields may include:

- provider ID;
- user ID when known;
- identity ID;
- request ID;
- IP/user agent under existing privacy/logging policy;
- coarse failure category.

Never audit raw ID token, access token, SAML assertion, LDAP password or client secret.

## Provider dependency strategy

Authentication protocols are security-sensitive. Do not implement cryptography/protocol parsing from scratch to avoid dependencies.

Use mature maintained libraries for:

- OIDC/OAuth token/discovery/JWKS validation;
- LDAP protocol client;
- SAML XML/signature handling.

Selection criteria:

- active maintenance;
- Node 24 support;
- minimal transitive risk where possible;
- protocol standards compliance;
- timeout/TLS controls;
- no requirement for a different web framework/ORM.

Pin versions according to normal YunCMS dependency policy and include provider-specific integration tests.

## Implementation phases

### Phase A0 — Provider foundation

- provider registry/config loader;
- identity table;
- auth transaction table/store;
- public provider list endpoint;
- shared external-auth -> YunCMS session issuance helper;
- generic linking/provisioning policy;
- redaction/error model.

Exit criterion: protocol drivers can plug into one identity/session pipeline without duplicating RBAC/session logic.

### Phase A1 — OIDC

- discovery;
- authorization code + state/nonce/PKCE;
- JWKS/signature/issuer/audience validation;
- identity linking;
- optional JIT;
- Studio login button/callback handoff;
- Google/Microsoft/Keycloak-compatible integration tests.

Exit criterion: at least two independent OIDC providers work through the same generic driver.

### Phase A2 — OAuth2

- generic authorization/token/user-info flow;
- safe attribute mapping;
- provider presets only as configuration sugar;
- integration tests with a non-OIDC OAuth provider fixture/mock.

Exit criterion: identity login works without introducing provider-specific route code.

### Phase A3 — LDAP

- TLS/search/bind flow;
- safe filters;
- stable identifier mapping;
- optional JIT/group mapping;
- timeout/error tests;
- Active Directory-compatible test environment where possible.

Exit criterion: directory users authenticate without storing LDAP passwords and map safely to YunCMS roles.

### Phase A4 — SAML

- SP metadata/config;
- login/ACS flow;
- signature/audience/destination/time/replay validation;
- NameID/attribute mapping;
- certificate rollover testing;
- multi-instance replay-state test.

Exit criterion: standards-compliant SAML IdP integration works without bypassing normal YunCMS user/role/session model.

## Required test matrix

### Common

- inactive user denied after valid provider authentication;
- linked identity resolves correct current role;
- provider login cannot create Administrator/Public via JIT;
- duplicate `(provider, subject)` race is safe;
- same email from unrelated provider does not auto-take over account by default;
- auth transaction expiry/replay rejected;
- open redirect attempts rejected;
- provider secrets/tokens absent from logs/errors/audit;
- rate limits apply;
- two replicas can start login on one and finish callback on another;
- logout revokes YunCMS session;
- disabling user invalidates future authorization.

### OIDC

- invalid state;
- invalid nonce;
- wrong issuer;
- wrong audience;
- expired token;
- invalid signature;
- JWKS rotation;
- unverified email handling;
- PKCE mismatch;
- provider timeout.

### OAuth2

- token exchange failure;
- malformed user-info;
- missing stable subject;
- unsafe mapping rejected;
- state/PKCE failure.

### LDAP

- LDAP injection characters in username;
- wrong password;
- user not found returns generic response;
- bind/search timeout;
- TLS validation failure;
- multiple directory matches fail closed;
- group mapping ambiguity.

### SAML

- unsigned/invalid signature;
- wrong audience;
- wrong destination;
- expired/not-yet-valid assertion;
- assertion replay;
- unknown NameID mapping;
- certificate rollover;
- oversized/malformed XML rejected safely.

## MFA/2FA note

MFA is also a Directus parity gap, but it is intentionally not bundled into the provider-driver implementation.

After provider support, add a separate MFA roadmap covering at least TOTP and recovery codes if local-account MFA is required. Enterprise IdPs may already enforce MFA upstream, but YunCMS should not assume that every provider does.

## Deliberate non-goals

For this roadmap:

- no social-provider-specific duplicated auth stacks;
- no provider token as YunCMS bearer token;
- no automatic admin role from external claims;
- no unsafe email-only account linking by default;
- no storing LDAP passwords;
- no hand-written OIDC/SAML cryptography;
- no global SSO logout promise in first implementation;
- no SCIM provisioning in this phase;
- no MFA bundled into initial provider drivers.

## Definition of done

This roadmap is complete when YunCMS supports modern OIDC SSO, fallback generic OAuth2, enterprise LDAP/AD and SAML through a common provider/identity architecture; all successful logins converge into ordinary YunCMS users/sessions/accountability; linking/JIT behavior is explicit and safe; and multi-instance/provider failure cases do not create account-takeover, replay, secret-leak or RBAC bypass paths.
