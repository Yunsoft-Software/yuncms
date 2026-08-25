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

A successful local or external login creates a server-side session with hashed access/refresh credentials and expiries plus optional request metadata.

Default lifetime:

- access token: 15 minutes;
- refresh/session: 30 days.

Use the returned access token for ordinary API requests:

```http
Authorization: Bearer yca_...
```

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
