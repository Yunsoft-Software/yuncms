# Authentication

This document describes authentication behavior implemented on branch `16-08-2026`.

## Model

YunCMS currently uses opaque server-side credentials rather than JWTs.

Credential/action token types have distinct prefixes:

- `yca_...` — short-lived session access token;
- `ycr_...` — refresh token;
- `yct_...` — static API token;
- `ycp_...` — password-reset token;
- `ycv_...` — email-verification token.

Only SHA-256 token hashes are stored in MySQL. Plain access/refresh/API/action token secrets are returned only to the issuing service caller and are not persisted as plaintext.

A prefix only chooses the expected token class; it is not authorization. Stored hash, expiry, user status and server-side state remain authoritative.

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
- a successful password reset also revokes every existing session for that user.

Logout endpoints require session authentication. A static API token is not treated as a session and cannot be used to perform session logout semantics.

## Bearer authentication

Application routes accept:

```text
Authorization: Bearer <credential>
```

The credential prefix selects the authentication path:

- access token -> active, unexpired session lookup;
- API token -> active user + unexpired API-token lookup;
- refresh/reset/verification token -> rejected as an application Bearer credential;
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

## Password reset tokens

`AuthTokensService.requestPasswordReset(email)` deliberately hides malformed, unknown and inactive accounts by returning no token for those cases. Any future public HTTP/mail adapter must return the same public response regardless of account existence.

For an active account, issuing a reset token removes older unused reset tokens for that user, creates a cryptographically random one-time token, stores only its hash in `yuncms_auth_tokens`, and applies a bounded expiry.

`AuthTokensService.resetPassword(token, password)`:

1. rejects the wrong token class before opening a DB transaction;
2. locks and re-checks the matching unused, unexpired token;
3. replaces the password hash for the active user;
4. marks the action token used;
5. revokes all sessions for the user;
6. removes other outstanding password-reset tokens.

Email delivery is not implemented yet. Raw reset tokens must not be exposed from a general production HTTP response merely to work around the missing transport.

## Email verification tokens

`AuthTokensService.createEmailVerification(userId)` may only issue a token for the same authenticated user or under administrator/system accountability. Older unused verification tokens for the user are replaced.

`AuthTokensService.verifyEmail(token)` locks and re-checks the unused, unexpired token, sets `email_verified_at` for an active user and consumes the token.

Email delivery is not implemented yet.

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

Password reset/email verification delivery routes are intentionally not exposed until a transport can deliver action-token secrets without returning them in a generic public API response.

## First administrator

The core setup helper can create the first administrator exactly once after bootstrap.

The setup helper:

1. checks for an existing administrator user;
2. reuses an existing administrator role or creates the initial `Administrator` role;
3. hashes the password through the normal password helper;
4. creates an active, initially verified administrator user;
5. refuses to silently create a second initial administrator on rerun.

The interactive `yuncms init` wizard still needs to wire this helper into its prompt flow.

## Tables

Authentication currently depends on:

- `yuncms_users`;
- `yuncms_roles`;
- `yuncms_sessions`;
- `yuncms_api_tokens`;
- `yuncms_auth_tokens`.

`yuncms_auth_tokens` is introduced by migration `0004-auth-action-tokens`.

## Not implemented yet

- mail transport and public password-reset/email-verification delivery endpoints;
- authentication rate limiting;
- configurable session TTLs;
- session-list UI/API;
- MFA/2FA;
- SSO/OIDC/SAML/LDAP.

Real MySQL/API verification remains tracked in `todo.md`.
