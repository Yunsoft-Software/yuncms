# Authentication

This document describes authentication behavior implemented on branch `16-08-2026`. Password-reset and email-verification token lifecycles are not implemented yet.

## Model

YunCMS currently uses opaque server-side credentials rather than JWTs.

Credential types have distinct prefixes:

- `yca_...` — short-lived session access token;
- `ycr_...` — refresh token;
- `yct_...` — static API token.

Reset/verification prefixes are reserved in the token helper but their lifecycles are not shipped.

Only SHA-256 token hashes are stored in MySQL. Plain access/refresh/API token secrets are returned to the caller when issued and are not persisted as plaintext.

## Passwords

Passwords are hashed with Node.js `crypto.scrypt` using a per-password random salt and encoded cost parameters. YunCMS does not implement a custom password cipher/hash algorithm.

The current default scrypt configuration is:

```text
N = 65536
r = 8
p = 1
key length = 64 bytes
```

Encoded parameters are bounded during verification so a malicious/corrupt stored hash cannot request unbounded work.

Login failures return the same `INVALID_CREDENTIALS` message for unknown users, bad passwords and inactive users. The unknown-user path still performs a dummy scrypt verification to avoid a trivial fast account-existence path.

## Sessions

A successful login creates one `yuncms_sessions` row containing:

- refresh-token hash;
- access-token hash;
- access expiry;
- refresh/session expiry;
- optional IP/user-agent metadata.

Current defaults:

- access token: 15 minutes;
- refresh token/session: 30 days.

### Refresh rotation

`POST /auth/refresh` consumes the current refresh token and rotates both access and refresh credentials.

The update includes the old refresh-token hash in its `WHERE` clause. If the same refresh token is replayed concurrently, only the first matching update can succeed; subsequent uses fail with `INVALID_CREDENTIALS`.

### Revocation

- `POST /auth/logout` deletes the current session by access-token hash.
- `POST /auth/logout-all` deletes all sessions for the authenticated user.
- changing a password through `UsersService.updatePassword()` deletes all existing sessions for that user in the same transaction as the password change.

Logout endpoints require session authentication. A static API token is not treated as a session and cannot be used to perform session logout semantics.

## Bearer authentication

Application routes accept:

```text
Authorization: Bearer <credential>
```

The credential prefix selects the authentication path:

- access token -> active, unexpired session lookup;
- API token -> active user + unexpired API-token lookup;
- refresh token -> rejected as a Bearer application credential;
- unknown/malformed token -> rejected.

Authenticated identity becomes explicit request accountability containing user, role and administrator state. Services receive that accountability directly.

## Public accountability

Requests without a Bearer credential use the role marked `public = 1`, if one exists.

YunCMS enforces one public role at both service and MySQL levels:

- `RolesService` rejects creating a second public role;
- a generated-column unique constraint prevents concurrent duplicate public roles;
- one role cannot be both `admin` and `public`.

If no public role exists, accountability is still explicitly public but has `role = null`; permission-controlled item access therefore fails closed.

`POST /auth/login` and `POST /auth/refresh` intentionally do not depend on public-role lookup. A damaged public-role configuration must not lock administrators out of the login/refresh path.

## API tokens

`ApiTokensService` supports:

- list the authenticated user's token metadata;
- create a token;
- delete/revoke a token.

Normal users can manage only their own API tokens. Administrator/system accountability may target another user.

Creation returns the token secret once. List responses never contain the token or its stored hash.

HTTP routes:

```text
GET    /auth/tokens
POST   /auth/tokens
DELETE /auth/tokens/:id
```

API tokens inherit the owning user's current role at authentication time. Disabling the user therefore disables the token. Optional token expiry is supported.

## Auth HTTP routes

```text
POST /auth/login
POST /auth/refresh
POST /auth/logout
POST /auth/logout-all
GET  /auth/tokens
POST /auth/tokens
DELETE /auth/tokens/:id
```

Login response contains user metadata plus newly issued access/refresh credentials. Refresh returns a rotated pair.

## First administrator

`yuncms init` bootstraps the schema and creates the first administrator exactly once.

The setup helper:

1. checks for an existing administrator user;
2. reuses an existing administrator role or creates the initial `Administrator` role;
3. hashes the password through the normal password helper;
4. creates an active, initially verified administrator user;
5. refuses to silently create a second initial administrator on rerun.

## Not implemented yet

- password-reset token lifecycle;
- email-verification token lifecycle for ordinary users;
- authentication rate limiting;
- configurable session TTLs;
- session-list UI/API;
- MFA/2FA;
- SSO/OIDC/SAML/LDAP.

These remain unchecked in `plan.md` and production verification remains in `todo.md`.
