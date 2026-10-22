# Authentication

YunCMS supports email/password sessions, static API tokens, password reset, email verification and optional external identity providers. Authentication always resolves to explicit request accountability; authorization is then evaluated by roles and permissions.

## Credential model

YunCMS uses opaque server-side credentials rather than self-contained JWT access claims.

Token prefixes identify the credential class:

- `yca_` — short-lived session access token;
- `ycr_` — refresh token;
- `yct_` — static API token;
- `ycp_` — password-reset token;
- `ycv_` — email-verification token.

Only token hashes are persisted. The database session/token state, expiry, owning user state and current role remain authoritative.

## Email/password login

```text
POST /auth/login
```

```bash
curl 'http://localhost:3008/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"your-password"}'
```

Passwords use Node.js `crypto.scrypt` with a random per-password salt and encoded bounded cost parameters.

Unknown user, wrong password and inactive-user attempts intentionally produce the same public invalid-credentials behavior. The unknown-user path still performs password work to reduce trivial account-existence timing differences.

## Sessions

A successful local or external login creates a server-side session with hashed access/refresh credentials and expiries plus optional request metadata. All token expirations and session activity timestamps evaluate against MySQL's `UTC_TIMESTAMP(3)`.

Default lifetime:

- access token: 15 minutes;
- refresh/session: 30 days.

Use the returned access token for ordinary API requests:

```http
Authorization: Bearer yca_...
```

> [!NOTE]
> When upgrading to the UTC deadline engine (migration `0022-utc-auth-deadlines`), all existing active sessions, pending action tokens, and in-flight external OAuth transactions were revoked to prevent pre-upgrade local-time deadlines from being artificially extended. Users establish fresh UTC-backed sessions by logging in again. Non-expiring API tokens, user accounts, roles, and permissions are fully preserved. Finite API tokens with expiration dates are revoked at migration and must be reissued.

### Refresh

```text
POST /auth/refresh
```

Refresh rotates both access and refresh credentials. The previous refresh hash participates in the database update, so two concurrent attempts to reuse the same refresh token do not both succeed.

### Logout

```text
POST /auth/logout
POST /auth/logout-all
```

`/auth/logout` revokes the current session. `/auth/logout-all` revokes all sessions for the authenticated user. These endpoints require a session access token rather than a static API token.

Changing or resetting a password also revokes existing sessions.

### User password changes

`PATCH /users/:id/password` accepts `{ "password": "new-password" }` and returns `204` on success. Authenticated users can change their own password; changing another user's password requires Administrator or explicit system accountability. Delegated user-management permissions do not grant access to another user's credentials.

Extensions can reject these changes through the veto-only [`users.password.update` filter](extensions.md#filters), including changes requested by Administrators, the user themselves or system services. The filter receives safe identity and transaction context, without the password or hash. Rejection leaves both the credential and existing sessions unchanged. Successful writes revoke sessions and emit the password action only after the outer native transaction commits. Direct `UsersService.updatePassword()` calls use the same boundary.

## API tokens

API tokens are long-lived bearer credentials for integrations and agents:

```text
GET    /auth/tokens
POST   /auth/tokens
DELETE /auth/tokens/:id
```

Normal users can manage their own tokens; administrative/system access can target another user where allowed.

The plaintext `yct_...` secret is returned only at creation time. List responses do not expose the secret or stored token hash.

API tokens resolve the owning user's current role when authenticated. Disabling the user or changing effective permissions therefore changes what the token can do; the token is not a frozen copy of old privileges.

## Public accountability

A request without a Bearer token is not treated as Administrator. It resolves to explicit Public accountability and the configured Public role. Public access is deny-by-default until permissions are intentionally granted.

This applies to normal Items reads and to system resources that explicitly support delegated/Public permissions, including Files.

## Public registration

Public registration is disabled by default. An Administrator can select one normal non-Administrator, non-Public role and enable signup under **Settings → Branding & Appearance → Public Registration**. Clients cannot choose their own role or account status.

```text
POST /auth/register
```

Optional required email verification keeps a new account from local sign-in until its one-time verification link is confirmed. Verification resend remains non-enumerating and rate-limited. See [Public registration](public-registration.md) for the full Studio, API, SMTP and failure contract.

## Password reset

Request a reset:

```text
POST /auth/password-reset/request
```

The public response is deliberately non-enumerating: callers should not be able to learn whether a supplied account exists or is active from this endpoint.

For an eligible active account, YunCMS creates a random one-time reset credential, stores only its hash and sends the raw token through the configured mail transport.

Confirm:

```text
POST /auth/password-reset/confirm
```

A successful confirmation consumes the one-time token, changes the password, revokes existing sessions and invalidates sibling reset credentials. Replay fails.

## Email verification

```text
POST /auth/email-verification/request
POST /auth/email-verification/confirm
```

Verification credentials are one-time and hashed at rest. Confirmation marks an active user's email as verified.

### Management-created users

`UsersService.createOne()` and Studio/API user-management are privileged management paths, not public signup. Users created this way are treated as management-created accounts and are marked verified immediately.

That includes the first Administrator created by `yuncms init` and users created by a delegated user manager with the corresponding permission.

## SMTP

Configure SMTP when password-reset/email-verification messages must be delivered:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=no-reply@example.com
AUTH_PUBLIC_URL=https://cms.example.com
```

`AUTH_PUBLIC_URL` must be the externally reachable origin used in links. SMTP URL/file loading in message content is disabled. A temporary SMTP failure does not by itself prevent the API process from starting.

## Authentication rate limiting

Authentication routes have independent fixed-window limits:

```env
AUTH_RATE_LIMIT_STORE=memory
AUTH_LOGIN_RATE_WINDOW_MS=60000
AUTH_LOGIN_RATE_MAX=10
AUTH_REFRESH_RATE_WINDOW_MS=60000
AUTH_REFRESH_RATE_MAX=30
AUTH_ACTION_RATE_WINDOW_MS=900000
AUTH_ACTION_RATE_MAX=5
```

`AUTH_RATE_LIMIT_STORE` accepts `memory` or `redis` and can share counters across replicas through Redis. See [Configuration](configuration.md).

Exceeded limits return HTTP 429 with a bounded `RATE_LIMITED` response.

# External authentication

Optional providers are configured with `AUTH_PROVIDERS` and provider-specific environment variables. Supported drivers are:

- OIDC;
- OAuth2;
- LDAP;
- SAML.

Public provider metadata is exposed through:

```text
GET /auth/providers
```

Studio can use this list to display configured sign-in methods.

## Browser-provider flow: OIDC, OAuth2, SAML

Start login:

```text
GET /auth/login/:provider
```

After authenticating at the identity provider, the provider returns to:

```text
GET  /auth/callback/:provider
POST /auth/callback/:provider
```

The method depends on the provider protocol. YunCMS finishes the browser leg with a short-lived handoff code; Studio exchanges it for normal YunCMS session credentials through:

```text
POST /auth/exchange
```

Browser providers require `AUTH_STATE_SECRET` with at least 32 characters. Provider URLs must use HTTPS.

External authentication validation failures use controlled HTTP responses. Malformed, missing, expired or already consumed OAuth/OIDC/SAML transaction state returns HTTP 400 with `INVALID_AUTH_TRANSACTION` and a safe reason; no session is created. Invalid provider/redirect inputs or the wrong provider flow also return 400, and unknown providers return 404. Identity linking restrictions and inactive users return 403; an existing-email linking conflict returns 409. Provider configuration failures remain 503 and invalid upstream identities/profile responses return 502, with internal details hidden.

## LDAP flow

LDAP uses a direct username/password request:

```text
POST /auth/login/:provider
```

`ldaps://` is required by default. Plain `ldap://` is accepted only when the provider explicitly sets `ALLOW_INSECURE=true`.

## Just-in-time user creation

Each provider can choose whether a valid external identity may create a local user:

```env
AUTH_PROVIDER_COMPANY_JIT=false
AUTH_PROVIDER_COMPANY_DEFAULT_ROLE=
```

If JIT is enabled, a default role is mandatory. Use a least-privilege role rather than Administrator.

## Account linking

Linking an external identity to an existing local account by verified email is off by default:

```env
AUTH_PROVIDER_COMPANY_LINK_BY_VERIFIED_EMAIL=false
```

Administrator linking has an additional independent guard:

```env
AUTH_PROVIDER_COMPANY_ALLOW_ADMIN_LINK=false
```

Do not enable either option merely to make a provider login work. Enable them only when the identity provider's verified-email semantics and account ownership model are trusted for your deployment.

## OIDC example

```env
AUTH_PROVIDERS=company
AUTH_STATE_SECRET=replace-with-a-long-random-secret
AUTH_PROVIDER_COMPANY_DRIVER=oidc
AUTH_PROVIDER_COMPANY_LABEL=Company SSO
AUTH_PROVIDER_COMPANY_ISSUER=https://id.example.com
AUTH_PROVIDER_COMPANY_CLIENT_ID=your-client-id
AUTH_PROVIDER_COMPANY_CLIENT_SECRET=your-client-secret
AUTH_PROVIDER_COMPANY_SCOPES=openid profile email
AUTH_PROVIDER_COMPANY_JIT=true
AUTH_PROVIDER_COMPANY_DEFAULT_ROLE=ROLE_UUID
```

OAuth2, LDAP and SAML variables are listed in [Configuration](configuration.md).

## Auth endpoint summary

```text
GET    /auth/providers
POST   /auth/login
GET    /auth/login/:provider
POST   /auth/login/:provider
GET    /auth/callback/:provider
POST   /auth/callback/:provider
POST   /auth/exchange
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

## First Administrator

`yuncms init`:

1. configures or reuses the project's environment;
2. verifies MySQL connectivity;
3. bootstraps required migrations;
4. checks whether an Administrator already exists;
5. prompts for the first Administrator only when needed;
6. creates that account as a verified management-created user;
7. does not silently create another initial Administrator on reruns.

See [Setup and CLI](setup-cli.md).

## Related guides

- [Configuration](configuration.md)
- [Roles and permissions](permissions.md)
- [REST API](rest-api.md)
- [Security](security.md)

## Native TOTP two-factor authentication

TOTP is optional and uses standard authenticator apps (RFC 6238, SHA-1, six digits,
30-second periods). An operator enables the capability by configuring a stable
`AUTH_TOTP_KEY`: 32 random bytes encoded as 64 hexadecimal characters. Generate
it with `openssl rand -hex 32`, store it as a deployment secret, and back it up
with the database. An absent key keeps enrollment unavailable; an invalid key
prevents startup. Losing or replacing the key does not disable enrolled factors:
TOTP verification fails closed until the correct key is restored. The key is
independent of AI and external-provider settings.

Discover support without authentication:

```text
GET /auth/capabilities
```

The response includes `data.totp` with `available`, `algorithm: "SHA1"`,
`digits: 6`, `period: 30`, and `recovery_codes: 8`. This describes the installation,
not whether a particular account is enrolled. Account status is session-only:
`GET /auth/tfa` returns `available`, `enabled`, `enrollment_pending`, and
`recovery_codes_remaining`. It never returns a saved seed or recovery codes.
Static API tokens cannot use the self-service TOTP endpoints.

### Enrollment and account security

Studio exposes **Settings → Two-factor authentication** to every signed-in user.
Enter the current password, add the displayed setup key manually to a standard
authenticator app, then confirm its current code. The same native API supports
custom frontends:

| Method and path | Body | Result |
| --- | --- | --- |
| `POST /auth/tfa/enroll` | `{ "password": "…" }` | `secret`, `otpauth_uri`, `expires_in: 600` |
| `POST /auth/tfa/confirm` | `{ "password": "…", "code": "123456" }` | `enabled: true`, eight `recovery_codes`, replacement `session` |
| `DELETE /auth/tfa/enroll` | None | Cancels unconfirmed enrollment |
| `POST /auth/tfa/recovery-codes` | Password and a current factor | Eight replacement `recovery_codes` and replacement `session` |
| `POST /auth/tfa/disable` | Password and a current factor | `enabled: false` and replacement `session` |

For a current factor send exactly one of `code` or `recovery_code`. Management
always targets the session user; user-management permissions do not grant access
to another account's factor. It requires a current local password, including for
accounts first created through SSO. Such users can establish a password through
the existing self password-change endpoint before enrollment.

A pending setup expires after ten minutes and does not enable two-factor
protection. Starting setup again replaces the pending seed. Confirming setup,
disabling protection or regenerating recovery codes revokes **all** old sessions
and pending login challenges atomically. Replace client session state with the
returned `session` (the normal `{ user, access_token, refresh_token, … }` shape).
Recovery codes appear only in the successful confirm/regenerate response; Studio
drops them when dismissed or reloaded. Save them privately. Each code works once;
regeneration invalidates every earlier code. Using a recovery code to sign in does
not automatically disable the authenticator.

The database stores authenticated, user-bound AES-256-GCM seed ciphertext and
SHA-256 hashes of random 128-bit recovery codes. Native mutation/audit hooks never
receive passwords, OTPs, seeds or plaintext recovery codes. All auth responses
use `Cache-Control: no-store`. Use HTTPS for remote clients; TOTP remains
susceptible to real-time phishing and is not a phishing-resistant authenticator.

### Login challenge

For unenrolled accounts the existing login response is unchanged. After a correct
password or a successful external-provider identity check, an enrolled account
receives a challenge instead of a session:

```json
{
  "data": {
    "mfa_required": true,
    "challenge_token": "ycm_…",
    "expires_in": 300,
    "methods": ["totp", "recovery_code"]
  }
}
```

No access/refresh credentials exist at this stage. Keep the challenge in temporary
UI state, not persistent session storage, and complete it with:

```text
POST /auth/tfa/verify
{ "challenge_token": "ycm_…", "code": "123456" }
```

Or send `recovery_code` instead of `code`. Success returns the ordinary session
shape under `data`. The challenge itself cannot authenticate a Bearer request or
refresh a session. A new primary login replaces the account's previous challenge.
Challenges expire after five minutes and allow at most five failed attempts.
They are single-use and bound to the factor revision and password fingerprint;
password changes/resets, suspension and logout-all also invalidate pending
challenges. Neither password reset nor email verification removes an enabled
factor. Concurrent verification cannot spend a TOTP step/recovery code twice.

The verifier permits one adjacent time step in either direction. A successfully
used step cannot be reused or followed by an older step, including the step used
to confirm enrollment. Ten failed account verification attempts lock further
verification for five minutes; these counters survive restarts and new challenges.
The existing auth-action IP limiter applies too. Wrong/expired login verification
returns `401 INVALID_CREDENTIALS`; invalid management proof returns
`400 INVALID_TFA_VERIFICATION`; a lock returns `429 RATE_LIMITED`. Missing or
unusable encryption keys return `503 TFA_UNAVAILABLE` / `TFA_KEY_INVALID`.

Local, LDAP and browser-provider login/handoff results all follow this challenge
contract; client adapters must handle it before saving a session. Session refresh
continues for an already completed session. Static API tokens remain separate
non-interactive integration credentials, with their existing ownership, expiry,
revocation and permission rules; enrollment does not silently remove them.

Trusted server code uses `TotpService` with explicit accountability, database and
`authConfig: config.auth`. Its methods mirror the operations above:
`capabilities()`, `status()`, `beginEnrollment()`, `confirmEnrollment()`,
`cancelEnrollment()`, `regenerateRecoveryCodes()`, `disable()` and
`completeLogin()`. Primary identity verification remains the responsibility of
`AuthService` / `ExternalAuthService`; the internal primary-login bridge rejects
calls without native identity admission. Extensions should use those native login
services rather than minting sessions. The native session creation guard rejects
an enrolled account without an internally verified second factor.
