# Features, Licensing and Production Operations (YunCMS 2.1.4)

> **Published Version:** `YunCMS 2.1.4` · **Git Tag:** `v2.1.4` · **Commit:** `6bb66f3fdfefe2f27bde7c2d96f9c494d1c2c45e`

YunCMS Community (MIT) and YunCMS Premium (`LicenseRef-YunCMS-Commercial`) share one codebase, npm distribution, and Docker image. Activating Premium does not require a fork, migration, or separate database.

## Feature tiers in YunCMS 2.1.4

| Feature key | Edition | Controlled capability |
| --- | --- | --- |
| `aiAssistant` | Community · MIT | Studio AI assistant HTTP access and tool execution |
| `aiFlows` | Community · MIT | AI Flow operations and legacy automation execution |
| `mcp` | Community · MIT | Official MCP HTTP endpoint |
| `flowScripts` | Community · MIT | Native Flow script operations (also requires `FLOWS_SCRIPTS_ENABLED=true`) |
| `contentHistory` | Premium · Commercial | Opt-in revision recording, history inspection, and record restoration |
| `whiteLabel` | Premium · Commercial | Custom Studio name, logo, and favicon; hides vendor branding and links (disabled by default until explicitly enabled by an Administrator) |

![YunCMS 2.1.4 Features and license screen](screenshot:studio-features-en)

## Local entitlement verification and activation

YunCMS `2.1.4` embeds the official Yunsoft Commerce Ed25519 public trust anchor (`kid: 1cbcc4d3173d0c15`) and verifies signed entitlement tokens locally without calling a licensing server on requests.

1. **Installation domain resolution**: YunCMS automatically derives the licensed hostname from your non-local public URL (`AUTH_PUBLIC_URL`, `YUNCMS_PUBLIC_URL`, or `STUDIO_ORIGIN`), or from explicit `YUNCMS_LICENSE_DOMAIN`. Loopback URLs (`localhost`, `127.0.0.1`) and HTTP `Host` / `X-Forwarded-Host` headers are never trusted to derive the installation domain.
2. **Activation in Studio**: open **Settings → Features and license**, verify the displayed installation domain, paste the full three-part signed entitlement JWT (`YUNSOFT-ENTITLEMENT+JWT`, starting with `eyJ...`, not a short reference key), and select **Activate license**.
3. **Supported billing models**:
   - Term licenses (`billingModel: monthly_term`) with an explicit integer Unix expiration `exp` and optional `periodMonths`.
   - Perpetual licenses (`billingModel: one_time_perpetual`) with `exp: null`.
4. **Expiry continuity**: when a term entitlement expires, Premium gates deactivate cleanly while Community CRUD, authentication, RBAC, Files, stored revisions, and saved branding values remain intact until a renewed signed entitlement is installed.
5. **Security guarantees**: tokens are never returned by `GET /features` or written to audit logs. Activation enforces Ed25519 signature, issuer `yunsoft-commerce`, product `yuncms_premium`, domain (`allowedHosts` / `stagingHosts`), optional `activatedInstanceId`, time bounds (`nbf`, `iat`, `exp`), and anti-rollback `entitlementVersion` checks.

### Optional three-month Premium offer

Set `YUNCMS_PREMIUM_OFFER_URL` to the approved Yunsoft Website campaign URL. Interactive `yuncms init` offers to print the link and defaults to no. In Studio, an administrator can reveal the link or skip the offer. Complete verified email subscription and domain verification on the Website. The offer requires no credit card. Paste the signed three-month entitlement into the existing Studio license form.

### Feature and license endpoints

- `GET /features` — effective feature map for authenticated users; non-secret license status for Administrators.
- `PATCH /features/:feature` — Administrator toggle (`{"enabled": true|false}`); cannot override operator `YUNCMS_FEATURES_DISABLED` or missing Premium entitlements.
- `POST /features/license` — Administrator activation with `{"token": "<signed JWT>"}`.

## Production operations checklist

Before exposing YunCMS `2.1.4` to the internet:

1. Terminate TLS at a reverse proxy, set `AUTH_PUBLIC_URL` and `STUDIO_ORIGIN` to the public `https://` origin, and set `TRUST_PROXY_HOPS` to the exact trusted proxy count.
2. Keep `.env`, `AUTH_TOTP_KEY`, and `.yuncms/ai-settings.key` private and included in encrypted backup plans.
3. Configure Redis (`CACHE_STORE=redis`, `API_RATE_LIMIT_STORE=redis`, `AUTH_RATE_LIMIT_STORE=redis`) when running multiple API replicas.
4. Monitor `GET /health` and `GET /ready` from your load balancer or container orchestrator.
5. Back up MySQL and local `uploads/` (or enable S3 provider backups/versioning) before every upgrade.
6. Pin exact versions (`@yunsoft/yuncms@2.1.4` or `yunsoftofficial/yuncms:2.1.4`) and verify upgrades with `npx yuncms update --dry-run`.

Return to [YunCMS 2.1.4 Overview](doc:overview) or [Installation Guide (YunCMS 2.1.4)](doc:installation).
