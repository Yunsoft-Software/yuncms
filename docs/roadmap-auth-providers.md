# External Authentication — Implemented Source Boundary

Target baseline: `22-08-2026`.

Completed A0–A4 roadmap phases have been removed. There is currently **no pending source task required by the original OIDC/OAuth2/LDAP/SAML roadmap**. Provider interoperability and real browser/directory/IdP verification remain in `todo.md`.

## Identity model

All successful authentication methods converge to an ordinary YunCMS user/session/accountability:

```text
local password / OIDC / OAuth2 / LDAP / SAML
                    |
                    v
           yuncms_users identity
                    |
                    v
          current YunCMS role/RBAC
                    |
                    v
      YunCMS access + refresh session
```

External provider tokens/assertions are not YunCMS bearer credentials.

Migration `0013-external-auth-foundation` adds:

```text
yuncms_auth_identities
yuncms_auth_transactions
```

Identity uniqueness is based on:

```text
(provider, subject)
```

not on mutable email text alone.

## Linking and JIT policy

Default behavior is existing-link-only. A matching email does **not** automatically take over an existing YunCMS user.

Per-provider policy may explicitly enable:

- JIT user creation with a configured normal role;
- verified/trusted email linking;
- administrator email linking only through a separate explicit opt-in.

JIT/default role checks reject Administrator and Public roles.

Inactive YunCMS users cannot obtain a new session even after valid external authentication.

## Browser transaction security

OIDC/OAuth/SAML browser state is stored as short-lived one-time MySQL state.

The transaction layer provides:

- high-entropy state;
- hashed lookup state;
- one-time consumption under transaction/row lock;
- short expiry;
- local redirect-target validation;
- encrypted secret state for PKCE/nonce/browser handoff;
- replay rejection.

After a browser callback, YunCMS does **not** put access/refresh tokens in the redirect URL. The callback creates a short-lived one-time `auth_code`; Studio exchanges that code with `POST /auth/exchange` and stores the resulting normal YunCMS session.

## OIDC

The generic OIDC driver uses `openid-client` and supports:

- discovery;
- Authorization Code flow;
- PKCE;
- state;
- nonce;
- ID-token expectation and library validation of issuer/audience/signature/time according to the discovered configuration;
- optional user-info retrieval with validated ID-token claims as fallback;
- stable `sub` identity by default;
- configurable claim names;
- generic provider configuration rather than Google/Microsoft-specific route code.

OIDC provider configuration is environment-first and secrets are excluded from `/auth/providers`.

## Generic OAuth2

The OAuth2 driver uses the same authorization-code/PKCE/state foundation but requires explicit operator configuration for:

- issuer;
- authorization endpoint;
- token endpoint;
- user-info endpoint;
- client authentication style;
- stable subject/email claim mappings.

The returned access token is used only to obtain provider profile data and is not persisted as the YunCMS session token.

## LDAP / Active Directory

LDAP login:

1. optionally binds with a configured service account;
2. searches with an escaped equality filter;
3. requires exactly one directory match;
4. binds as the discovered user with the submitted password;
5. immediately discards the submitted password after the request;
6. maps the directory identity into the common external-auth/session pipeline.

TLS (`ldaps://`) is required by default. Plain `ldap://` requires an explicit insecure-development opt-in.

A directory DN is used only for the user bind. It is **not** the persistent YunCMS identity subject. The persistent subject comes from a configurable stable directory attribute:

```env
AUTH_PROVIDER_CORP_SUBJECT_ATTRIBUTE=entryUUID
```

`entryUUID` is the default. Active Directory installations may configure for example:

```env
AUTH_PROVIDER_CORP_SUBJECT_ATTRIBUTE=objectGUID
```

Binary identifiers are normalized to a deterministic hexadecimal subject before storing `(provider, subject)`.

## SAML 2.0

The SAML driver uses `@node-saml/node-saml`; XML/signature validation is not hand-written.

Current source behavior includes:

- SP-initiated login;
- signed response/assertion requirements;
- issuer/configured IdP certificate validation through the library;
- `InResponseTo` validation set to `always`;
- bounded clock skew;
- stable NameID subject;
- configurable email attribute;
- MySQL-backed request-id cache so replay/request correlation does not depend on one API process;
- one-time YunCMS browser handoff after validation.

IdP-initiated SSO and global SAML SLO are not promised by this implementation.

## Studio UX

Studio login now reads safe provider metadata from:

```text
GET /auth/providers
```

Browser providers render as provider buttons. LDAP providers switch to the provider username/password flow. Browser callback `auth_code` is exchanged once and removed from the URL.

Local email/password login remains available.

## Public endpoints

```text
GET  /auth/providers
GET  /auth/login/:provider          # OIDC/OAuth/SAML begin
POST /auth/login/:provider          # LDAP credential flow
GET  /auth/callback/:provider       # OIDC/OAuth callback
POST /auth/callback/:provider       # SAML POST callback
POST /auth/exchange                 # one-time browser handoff
```

Provider secrets, LDAP bind passwords, certificates/private configuration and raw provider tokens are never part of `/auth/providers` output.

## Deliberate non-goals

The original provider roadmap does not include:

- provider tokens as YunCMS bearer tokens;
- email-only automatic account takeover by default;
- automatic Administrator/Public JIT roles;
- storing LDAP passwords;
- hand-written OIDC/SAML crypto;
- global IdP logout/SAML SLO guarantees;
- SCIM provisioning;
- MFA/TOTP/recovery codes.

MFA remains a separate product/security roadmap if local-account MFA becomes a requirement.

## Remaining work

Source implementation for the original external-provider roadmap is complete. Real OIDC/OAuth2/LDAP/AD/SAML compatibility, replay/failure matrices and Studio browser checks must still be run in environments with actual providers; those exact checks are listed in `todo.md`.
