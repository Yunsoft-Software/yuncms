# Configuration Reference

YunCMS is configured with environment variables. A generated project's `.env` is the normal place for deployment-specific values; never commit real passwords, tokens, SMTP credentials, S3 secrets or external-auth client secrets.

This guide documents the current configuration surface. Defaults below are the runtime defaults unless noted otherwise.

## Server

```env
HOST=127.0.0.1
PORT=3008
LOG_LEVEL=info
STUDIO_ORIGIN=http://localhost:3008
TRUST_PROXY_HOPS=0
```

- `HOST` — interface the API binds to.
- `PORT` — HTTP port.
- `LOG_LEVEL` — application log verbosity.
- `STUDIO_ORIGIN` — canonical Studio origin. Studio is normally served by the API on the same origin.
- `TRUST_PROXY_HOPS` — exact number of trusted reverse-proxy hops. Keep `0` when the API receives client traffic directly. Do not enable broad proxy trust just to make client IPs appear correct.

## MySQL

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=yuncms
DB_USER=yuncms
DB_PASSWORD=
DB_CONNECTION_LIMIT=10
DB_SSL=false
```

YunCMS supports MySQL for its application database. Give the runtime database user the privileges required by your chosen schema-management workflow. Studio/schema administration performs real DDL, so a deployment that uses those features needs the corresponding MySQL privileges.

`DB_CONNECTION_LIMIT` controls the mysql2 pool size for a process. Size this together with the number of application replicas and the MySQL server's connection budget.

## Redis shared state

A single-process installation can use in-memory cache and rate-limit state. Multi-process/multi-replica deployments can move those stores to Redis.

```env
REDIS_URL=redis://127.0.0.1:6379
REDIS_PREFIX=yuncms:default:
REDIS_REQUIRED=false
REDIS_CONNECT_TIMEOUT_MS=5000
REDIS_COMMAND_TIMEOUT_MS=3000
```

`REDIS_URL` is required when any configured store is `redis`.

`REDIS_PREFIX` isolates this YunCMS deployment inside a shared Redis server. Use a unique prefix per environment/project.

When `REDIS_REQUIRED=true`, Redis availability is treated as required shared state and readiness reflects that requirement. Use this when losing shared state should prevent the replica from accepting production traffic.

## Permission cache

```env
CACHE_ENABLED=true
CACHE_STORE=memory
CACHE_TTL_MS=30000
CACHE_MAX_ENTRIES=5000
```

`CACHE_STORE` accepts:

```text
memory
redis
```

The cache stores permission-related data; it does not bypass authorization. Permission mutations invalidate the relevant cache state.

For one process, `memory` is simple and fast. For multiple replicas, use `redis` when shared cache behavior is desired:

```env
CACHE_STORE=redis
REDIS_URL=redis://127.0.0.1:6379
```

## Global API rate limit

```env
API_RATE_LIMIT_ENABLED=true
API_RATE_LIMIT_STORE=memory
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_MAX=300
API_RATE_LIMIT_MAX_BUCKETS=10000
RATE_LIMIT_FAILURE_MODE=best-effort
```

`API_RATE_LIMIT_STORE` accepts `memory` or `redis`.

`RATE_LIMIT_FAILURE_MODE` controls behavior if the selected shared rate-limit store fails:

- `best-effort` — avoid turning a temporary store failure into a complete API outage;
- `required` — treat rate-limit state failure as a hard dependency.

For multiple API replicas, Redis prevents each process from maintaining an independent request counter:

```env
API_RATE_LIMIT_STORE=redis
REDIS_URL=redis://127.0.0.1:6379
```

Health/readiness and already-served Studio assets are handled separately from normal API request limiting.

## Authentication rate limits

```env
AUTH_RATE_LIMIT_STORE=memory
AUTH_LOGIN_RATE_WINDOW_MS=60000
AUTH_LOGIN_RATE_MAX=10
AUTH_REFRESH_RATE_WINDOW_MS=60000
AUTH_REFRESH_RATE_MAX=30
AUTH_ACTION_RATE_WINDOW_MS=900000
AUTH_ACTION_RATE_MAX=5
```

`AUTH_RATE_LIMIT_STORE` accepts `memory` or `redis` and defaults to the API rate-limit store when not set.

The login limiter keys requests using client identity plus the attempted account identifier. Refresh and security-sensitive auth actions have separate windows and limits.

## Pressure/load shedding

```env
PRESSURE_LIMIT_ENABLED=true
PRESSURE_MAX_CONCURRENT=250
PRESSURE_MAX_HEAP_PERCENT=95
PRESSURE_RETRY_AFTER_SECONDS=1
```

Pressure protection can reject new API work when the process exceeds configured concurrency or heap-pressure thresholds. This is load shedding, not a replacement for process/container memory limits or upstream traffic management.

## Local Files storage

```env
FILES_LOCAL_ROOT=uploads
FILES_MAX_UPLOAD_BYTES=26214400
```

`FILES_LOCAL_ROOT` is relative to the project working directory unless you use an absolute path. Back it up together with the database when local storage contains production assets.

`yuncms init` creates `uploads/` and writes that explicit project-local value. If the variable is omitted entirely, the core runtime fallback remains `.yuncms/uploads`; production deployments should set it explicitly to avoid ambiguity.

`FILES_MAX_UPLOAD_BYTES` defaults to 25 MiB.

## S3-compatible Files storage

```env
S3_BUCKET=
S3_REGION=us-east-1
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
```

S3-compatible storage can be used with providers that implement the required S3 API surface. `S3_ENDPOINT` is useful for compatible providers or self-hosted object storage; leave it empty when the normal provider endpoint should be used.

Uploads choose a registered storage driver through the Files API, for example:

```text
POST /files?storage=s3
```

See [Files](files.md).

## SMTP and account actions

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
AUTH_PUBLIC_URL=http://localhost:3008
```

SMTP is needed for email-delivered password-reset and email-verification flows.

`AUTH_PUBLIC_URL` is the public origin used to build reset/verification links. In production it should be the externally reachable HTTPS URL, not an internal container hostname.

## External authentication providers

YunCMS can expose OIDC, OAuth2, LDAP and SAML providers. Providers are opt-in and are named through a comma-separated list:

```env
AUTH_PROVIDERS=company,support
```

Each provider receives a normalized prefix. Provider id `company` uses:

```text
AUTH_PROVIDER_COMPANY_...
```

Browser-based providers (OIDC/OAuth2/SAML) also require a state secret of at least 32 characters:

```env
AUTH_STATE_SECRET=replace-with-a-long-random-secret
```

### Common provider settings

```env
AUTH_PROVIDER_COMPANY_DRIVER=oidc
AUTH_PROVIDER_COMPANY_LABEL=Company SSO
AUTH_PROVIDER_COMPANY_JIT=false
AUTH_PROVIDER_COMPANY_DEFAULT_ROLE=
AUTH_PROVIDER_COMPANY_LINK_BY_VERIFIED_EMAIL=false
AUTH_PROVIDER_COMPANY_ALLOW_ADMIN_LINK=false
```

Supported drivers:

```text
oidc
oauth2
ldap
saml
```

When `..._JIT=true`, `..._DEFAULT_ROLE` is required. JIT controls whether a valid external identity can create a local YunCMS user. Linking by verified email is disabled by default. Administrator-account linking also requires the explicit `..._ALLOW_ADMIN_LINK=true` policy.

### OIDC

```env
AUTH_PROVIDER_COMPANY_DRIVER=oidc
AUTH_PROVIDER_COMPANY_ISSUER=https://id.example.com
AUTH_PROVIDER_COMPANY_CLIENT_ID=
AUTH_PROVIDER_COMPANY_CLIENT_SECRET=
AUTH_PROVIDER_COMPANY_SCOPES=openid profile email
AUTH_PROVIDER_COMPANY_SUBJECT_CLAIM=sub
AUTH_PROVIDER_COMPANY_EMAIL_CLAIM=email
AUTH_PROVIDER_COMPANY_EMAIL_VERIFIED_CLAIM=email_verified
```

### OAuth2

```env
AUTH_PROVIDER_COMPANY_DRIVER=oauth2
AUTH_PROVIDER_COMPANY_ISSUER=https://id.example.com
AUTH_PROVIDER_COMPANY_AUTHORIZATION_ENDPOINT=https://id.example.com/oauth/authorize
AUTH_PROVIDER_COMPANY_TOKEN_ENDPOINT=https://id.example.com/oauth/token
AUTH_PROVIDER_COMPANY_USERINFO_ENDPOINT=https://id.example.com/oauth/userinfo
AUTH_PROVIDER_COMPANY_CLIENT_ID=
AUTH_PROVIDER_COMPANY_CLIENT_SECRET=
AUTH_PROVIDER_COMPANY_CLIENT_AUTH=post
AUTH_PROVIDER_COMPANY_SCOPES=profile email
AUTH_PROVIDER_COMPANY_SUBJECT_CLAIM=sub
AUTH_PROVIDER_COMPANY_EMAIL_CLAIM=email
AUTH_PROVIDER_COMPANY_EMAIL_VERIFIED_CLAIM=email_verified
```

`..._CLIENT_AUTH` accepts `post` or `basic`.

### LDAP

Secure LDAP is the default:

```env
AUTH_PROVIDER_DIRECTORY_DRIVER=ldap
AUTH_PROVIDER_DIRECTORY_URL=ldaps://ldap.example.com
AUTH_PROVIDER_DIRECTORY_BASE_DN=ou=people,dc=example,dc=com
AUTH_PROVIDER_DIRECTORY_BIND_DN=
AUTH_PROVIDER_DIRECTORY_BIND_PASSWORD=
AUTH_PROVIDER_DIRECTORY_USER_ATTRIBUTE=uid
AUTH_PROVIDER_DIRECTORY_SUBJECT_ATTRIBUTE=entryUUID
AUTH_PROVIDER_DIRECTORY_EMAIL_ATTRIBUTE=mail
AUTH_PROVIDER_DIRECTORY_ALLOW_INSECURE=false
```

Plain `ldap://` is rejected unless `..._ALLOW_INSECURE=true` is explicitly set.

### SAML

```env
AUTH_PROVIDER_COMPANY_DRIVER=saml
AUTH_PROVIDER_COMPANY_ENTRY_POINT=https://id.example.com/sso
AUTH_PROVIDER_COMPANY_ISSUER=https://your-yuncms.example.com
AUTH_PROVIDER_COMPANY_IDP_CERT="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
AUTH_PROVIDER_COMPANY_IDP_ISSUER=
AUTH_PROVIDER_COMPANY_EMAIL_ATTRIBUTE=email
AUTH_PROVIDER_COMPANY_CLOCK_SKEW_MS=5000
```

The identity-provider certificate must be PEM. Clock skew must be an integer from 0 to 120000 ms.

See [Authentication](auth.md) for login behavior and account-linking security.

## Public registration

Public registration is configured in **Studio → Settings → Branding & Appearance**, not with environment variables. It is disabled by default and requires an explicit normal role. Optional required email verification uses the SMTP and `AUTH_PUBLIC_URL` configuration described above.

See [Public registration](public-registration.md) for the complete contract.

## MCP

MCP is not configured through environment variables. An Administrator manages it in **Studio → Settings → MCP Connection**. The database-backed settings control endpoint enablement, write tools, authentication, exact Host/Origin allowlists and result limits. Changes apply without restarting YunCMS.

See [MCP](mcp.md) before exposing this endpoint outside a trusted network.

## Audit retention

```env
AUDIT_RETENTION_DAYS=90
AUDIT_CLEANUP_BATCH_SIZE=1000
AUDIT_CLEANUP_MAX_BATCHES=100
```

Cleanup only runs when explicitly invoked. These settings define its default retention and bounded batch behavior.

## CLI command timeouts

```env
YUNCMS_CLI_COMMAND_TIMEOUT_MS=900000
YUNCMS_DB_TOOL_TIMEOUT_MS=7200000
```

These protect managed setup/update/backup subprocesses from hanging forever. Increase them only when a verified large installation or slow database genuinely needs a larger window.

## AI assistant configuration

The built-in AI assistant's provider/model/key settings are configured through Studio rather than ordinary `.env` values. The API key is encrypted using a local YunCMS secret key file under project state. Back up the required AI settings/key material together according to the [upgrade/backup guidance](upgrades.md).

See [AI assistant](ai-assistant.md).

## Example: single-process installation

```env
HOST=127.0.0.1
PORT=3008
DB_HOST=127.0.0.1
DB_DATABASE=yuncms
DB_USER=yuncms
DB_PASSWORD=replace-me
CACHE_STORE=memory
API_RATE_LIMIT_STORE=memory
AUTH_RATE_LIMIT_STORE=memory
```

## Example: multi-replica shared state

```env
CACHE_STORE=redis
API_RATE_LIMIT_STORE=redis
AUTH_RATE_LIMIT_STORE=redis
REDIS_URL=redis://redis.internal:6379
REDIS_PREFIX=yuncms:production:
REDIS_REQUIRED=true
RATE_LIMIT_FAILURE_MODE=required
```

Configure the reverse proxy/load balancer separately and set `TRUST_PROXY_HOPS` to the exact trusted hop count.

## Related guides

- [Setup and CLI](setup-cli.md)
- [Deployment](deployment.md)
- [Security](security.md)
- [Authentication](auth.md)
- [Public registration](public-registration.md)
- [Files](files.md)
- [MCP](mcp.md)
