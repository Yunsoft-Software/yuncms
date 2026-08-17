# Authentication

This document describes authentication behavior implemented on branch `16-08-2026`.

## Credential model

YunCMS uses opaque server-side credentials rather than JWTs.

Token prefixes are intentionally distinct:

- `yca_` — short-lived access token;
- `ycr_` — refresh token;
- `yct_` — static API token;
- `ycp_` — password-reset token;
- `ycv_` — email-verification token.

Only SHA-256 token hashes are persisted. Prefixes identify the token class; stored hash, expiry, active-user state and server-side session/token state remain authoritative.

## Passwords

Passwords use Node.js `crypto.scrypt` with a random per-password salt and bounded encoded cost parameters. YunCMS does not implement a custom password crypto algorithm.

Unknown user, wrong password and inactive-user login attempts intentionally return the same public `INVALID_CREDENTIALS` response. The unknown-user path still performs a dummy password verification to reduce trivial account-existence timing differences.

## Sessions

Successful login creates a server-side session containing access/refresh hashes and expiries plus optional IP/user-agent metadata.

Current defaults:

- access token: 15 minutes;
- refresh/session: 30 days.

Refresh rotates both access and refresh credentials. The DB update includes the previous refresh hash, so concurrent reuse of the same refresh token allows only one successful rotation.

Revocation behavior:

- `/auth/logout` revokes the current session;
- `/auth/logout-all` revokes all sessions for the authenticated user;
- password change revokes all sessions in the password-change transaction;
- password reset revokes all sessions while consuming the reset token.

## Bearer authentication and accountability

Application routes accept:

```text
Authorization: Bearer <access-or-api-token>
```

Refresh/reset/verification tokens are not valid application Bearer credentials.

Authenticated identity becomes explicit accountability containing user, role and administrator state. Requests without a bearer credential receive explicit public accountability and the configured public role when one exists. Missing role/permission access fails closed.

## API tokens

Normal users can list/create/revoke only their own API tokens; admin/system accountability may target another user. Creation returns the secret once. List responses never expose token hashes or plaintext secrets.

```text
GET    /auth/tokens
POST   /auth/tokens
DELETE /auth/tokens/:id
```

API tokens resolve the owning user's current role at authentication time, so disabling the user disables the token.

## Password reset

Public request endpoint:

```text
POST /auth/password-reset/request
```

The public response is the same accepted response for malformed, unknown, inactive and active accounts. For an active account YunCMS replaces older unused reset tokens, creates a random one-time token and stores only its hash.

The raw token is passed only to the configured mail transport; it is not returned in the HTTP response.

Confirmation endpoint:

```text
POST /auth/password-reset/confirm
```

Consumption locks/rechecks the unused unexpired token, changes the password, marks the token used, revokes every session and removes sibling reset tokens. Replay fails.

## Email verification

Verification mail issuance remains available for an existing active user, or for another user under admin/system accountability:

```text
POST /auth/email-verification/request
POST /auth/email-verification/confirm
```

Older unused verification tokens are replaced. Confirmation sets `email_verified_at` for an active user and consumes the one-time token.

### Users created by management

`UsersService.createOne()` is a privileged management path, not a public signup path. Accounts created from Studio/API through this service are trusted as management-created users and receive `email_verified_at` immediately.

Consequences:

- an administrator-created user does not need a verification email before normal use;
- a delegated user manager with explicit `yuncms_users:create` permission gets the same management-created behavior;
- the first administrator created by `yuncms init` follows the same rule;
- old/unverified accounts can still use the verification workflow above;
- a future public/self-registration flow must be implemented separately if email ownership verification is required there.

## SMTP delivery

SMTP delivery uses Nodemailer. Configuration:

```text
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
AUTH_PUBLIC_URL=http://localhost:3008
```

`SMTP_HOST` and `SMTP_FROM` are required together when mail delivery is configured. Nodemailer file and URL message access are disabled so message content cannot load arbitrary local/remote resources through the transport.

SMTP is not synchronously verified during API startup: a temporary mail-provider outage should not prevent the entire CMS from starting. Delivery failures are logged through the redacting structured logger.

## Rate limiting

Login, refresh and reset/verification action routes use configurable fixed-window process-local limits:

```text
AUTH_LOGIN_RATE_WINDOW_MS=60000
AUTH_LOGIN_RATE_MAX=10
AUTH_REFRESH_RATE_WINDOW_MS=60000
AUTH_REFRESH_RATE_MAX=30
AUTH_ACTION_RATE_WINDOW_MS=900000
AUTH_ACTION_RATE_MAX=5
```

Exceeded limits return HTTP 429 with `RATE_LIMITED`.

The limiter is intentionally process-local in V1. Multi-instance deployment requires a shared limiter/store before relying on one global limit across replicas.

## Auth HTTP surface

```text
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
POST   /auth/logout-all
POST   /auth/password-reset/request
POST   /auth/password-reset/confirm
POST   /auth/email-verification/request
POST   /auth/email-verification/confirm
GET    /auth/tokens
POST   /auth/tokens
DELETE /auth/tokens/:id
```

## First administrator and `yuncms init`

The interactive init flow is wired to the reusable first-admin helper:

1. configure/reuse `.env`;
2. verify MySQL connectivity;
3. bootstrap migrations;
4. detect an existing administrator;
5. when absent, prompt for admin email/password and create/reuse the Administrator role;
6. create the first administrator as an already verified management-created account;
7. reruns do not silently create a second initial administrator.

## Tables

Authentication uses:

- `yuncms_users`;
- `yuncms_roles`;
- `yuncms_sessions`;
- `yuncms_api_tokens`;
- `yuncms_auth_tokens`.

`yuncms_auth_tokens` is introduced by migration `0004-auth-action-tokens`.

## Deliberate follow-ups

Not part of current single-process V1:

- shared-store/cluster-wide auth rate limiting;
- session-management UI/list endpoint;
- MFA/2FA;
- SSO/OIDC/SAML/LDAP;
- public/self-registration flow.

Real MySQL, SMTP and replay/rate-limit verification remains in `todo.md`.
