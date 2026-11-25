# YunCMS 2.1.4 Overview

> **Published Version:** `YunCMS 2.1.4` · **Git Tag:** `v2.1.4` · **Commit:** `6bb66f3fdfefe2f27bde7c2d96f9c494d1c2c45e`

YunCMS is a programmable MySQL CMS and backend platform with a focused React administration Studio, deny-by-default role-based access control (RBAC), local and S3-compatible Files storage, trusted JavaScript extensions, visual Flows, AI/MCP integrations, and a documented REST API.

![YunCMS 2.1.4 Content workspace](screenshot:studio-content-en)

## Published 2.1.4 packages

YunCMS `2.1.4` is distributed through four version-aligned npm packages and a multi-architecture container image built from tag `v2.1.4`:

| Artifact | Published version | Purpose |
| --- | --- | --- |
| `@yunsoft/yuncms` | `2.1.4` | CLI for project setup (`init`), migrations (`bootstrap`), runtime (`start`), `backup`, `restore`, and managed `update` |
| `@yunsoft/yuncms-api` | `2.1.4` | Express 5 REST API server and prebuilt React 19 Studio served on one port |
| `@yunsoft/yuncms-core` | `2.1.4` | MySQL 8 (`mysql2/promise`) services, schema engine, RBAC, authentication, Files, Flows, and local license verification |
| `@yunsoft/yuncms-extensions-sdk` | `2.1.4` | Helper contract (`defineEndpoint`, `defineHook`, `ExtensionError`) for trusted server extensions |
| `yunsoftofficial/yuncms:2.1.4` | `2.1.4` | Non-root Linux `amd64` and `arm64` Docker image with MySQL client tools |

## Key capabilities in YunCMS 2.1.4

- **MySQL-backed data model**: create collections, typed fields, system fields, singletons, navigation folders, and M2O/O2O/O2M/M2M relations with serialized physical DDL and metadata synchronization.
- **Native JSON number preservation (`2.1.4`)**: native reads decode nested JSON numbers as JavaScript numbers on MySQL while SQL `BIGINT` columns continue returning exact decimal strings.
- **Transaction-isolated permission cache (`2.1.4`)**: permission updates invalidate shared cache generations after transaction commit so concurrent requests cannot repopulate stale grants.
- **Focused React Studio**: single-port web interface with 8 languages (`en`, `tr`, `es`, `de`, `fr`, `pt-BR`, `ja`, `zh-CN`), light/dark themes, keyboard command palette, and responsive mobile views.
- **Shared Community & Premium distribution**: MIT Community core and commercial Premium capabilities (`contentHistory`, `whiteLabel`) ship in one distribution with offline Ed25519 entitlement verification.

## Guide index

1. [Installation Guide (YunCMS 2.1.4)](doc:installation) — requirements, pinned npm installation, `npx`, Docker Compose, and readiness checks.
2. [CLI, Configuration and Upgrades (YunCMS 2.1.4)](doc:setup-cli) — all CLI commands, core `.env` variables, backup/restore, and managed upgrades.
3. [Using YunCMS Studio (YunCMS 2.1.4)](doc:studio-guide) — workspace navigation, Content workbench, Files library, localization, branding, and mobile layouts.
4. [Data Model, Permissions and REST API (YunCMS 2.1.4)](doc:data-and-access) — schema modeling, deny-by-default RBAC, and the REST query language.
5. [Features, Licensing and Production Operations (YunCMS 2.1.4)](doc:licensing-and-operations) — Community/Premium capabilities, signed JWT activation, and production hardening.
