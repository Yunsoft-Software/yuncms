# YunCMS

**A programmable MySQL CMS/backend with a focused React Studio, strong role-based access control, Files, extensions, AI/MCP integrations and a documented REST API.**

YunCMS is developed by **Yunsoft**. Learn more about the company at **[Yunsoft — About](https://yunsoft.com/about)**.

> YunCMS is currently in the `0.1.x` pre-stable line. Use the managed backup/update flow and verify your own database, storage, proxy and authentication configuration before exposing a production installation.

## See YunCMS in action

<p align="center">
  <img src="docs/assets/screenshots/studio-content.png" alt="YunCMS Content workspace showing grouped collections and product records" width="100%">
</p>

<table>
  <tr>
    <td width="50%">
      <img src="docs/assets/screenshots/studio-data-model.png" alt="YunCMS Data Model with folders, drag handles and visibility controls">
      <br><strong>Model and organize content</strong><br>Create MySQL-backed collections, group the Content menu, drag to reorder and hide internal collections without changing their permissions.
    </td>
    <td width="50%">
      <img src="docs/assets/screenshots/studio-files.png" alt="YunCMS Files gallery">
      <br><strong>Manage files visually</strong><br>Upload, preview, search and manage local or S3-compatible assets through the same role-aware Studio.
    </td>
  </tr>
</table>

These screenshots were captured from the current published package. New users should follow the **[15-minute Getting Started guide](docs/getting-started.md)**; administrators can jump directly to **[Using Studio](docs/studio.md)**.

## Choose your path

| I want to… | Start here |
| --- | --- |
| Install YunCMS and create my first collection | [Getting Started](docs/getting-started.md) |
| Understand Content, Files, Data Model and users | [Using YunCMS Studio](docs/studio.md) |
| Design fields and relations | [Data Model Guide](docs/data-model.md) |
| Configure roles and safe public access | [Roles and Permissions](docs/permissions.md) |
| Connect a frontend or integration | [REST API](docs/rest-api.md) and [Items Query Language](docs/api-query-language.md) |
| Deploy, back up and update a server | [Deployment](docs/deployment.md), [Production Readiness](docs/production-readiness.md) and [Upgrades](docs/upgrades.md) |

## What YunCMS provides

- dynamic MySQL collections and fields;
- M2O, O2O, reverse O2M/O2O and managed M2M relations;
- schema-driven React Studio;
- REST CRUD for project collections;
- field selection including `*`, `relation.*` and `*.*`;
- filters with nested `_and` / `_or`;
- `search`, multi-field `sort`, `limit`, `offset`;
- `aggregate` and `groupBy`;
- field allowlists, row filters and create/update validation rules;
- explicit Public-role permissions;
- user/session/API-token authentication;
- optional Administrator-managed public registration with a fixed normal role and email verification;
- optional OIDC, OAuth2, LDAP and SAML authentication providers;
- local and S3-compatible Files storage;
- permission-managed public/filtered Files use cases;
- endpoint, hook and scheduled-job extensions;
- optional Studio AI assistant using normal YunCMS permissions;
- optional MCP endpoint using the same service/RBAC layer;
- in-memory or Redis-backed permission cache and rate-limit state;
- single-port Studio + API runtime;
- backup, restore and managed update commands.

## Requirements

```text
Node.js 24 LTS
npm 11+
MySQL 8-compatible server
```

## Quick start — no clone or fork required

Create an empty directory and run the published npm package directly with `npx`:

```bash
mkdir my-yuncms
cd my-yuncms
npx --yes @yunsoft/yuncms init
npx --yes @yunsoft/yuncms start
```

`init` interactively asks for the MySQL connection and first Administrator account, creates the project `.env`, verifies the database and applies the required migrations. The current directory becomes the YunCMS project directory, so `.env`, local Files and local extensions live there rather than inside the npm cache.

Default local URL:

```text
http://localhost:3008
```

The same listener serves Studio and the API.

### Persistent npm installation

The direct `npx` flow above is enough to initialize and run YunCMS without cloning this repository. For a long-lived installation that should record YunCMS in its own `package.json` and use the managed `yuncms update` flow, install the package once in that project directory:

```bash
npm init -y
npm install @yunsoft/yuncms
npx yuncms init
npx yuncms start
```

After a local install, `npx yuncms ...` uses the project dependency instead of downloading a temporary copy.

Useful commands:

```bash
npx yuncms init
npx yuncms bootstrap
npx yuncms start
npx yuncms backup
npx yuncms restore /path/to/backup --yes
npx yuncms update --dry-run
npx yuncms update --to <version>
npx yuncms help
```

If the package is not installed locally, use the full remote form instead, for example:

```bash
npx --yes @yunsoft/yuncms init
npx --yes @yunsoft/yuncms start
```

For initialization, backup/restore and updates, read **[Setup and CLI](docs/setup-cli.md)**.

For a complete first project—from installation through a collection, restricted role and API request—use **[Getting Started](docs/getting-started.md)**.

# First steps in Studio

After starting YunCMS, open `http://localhost:3008` and sign in with the Administrator created during initialization.

A normal first setup is:

1. open **Settings → Data Model**;
2. create a collection;
3. add fields and relations;
4. open **Roles & Permissions** and decide who may read/write it;
5. open the collection under **Content** and add records;
6. use **Files** for images/documents that collection records should reference.

The detailed interface walkthrough is in **[Using YunCMS Studio](docs/studio.md)**.

# Build a collection

You can use Studio or the Schema REST API.

Create a collection:

```bash
curl 'http://localhost:3008/schema/collections' \
  -X POST \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"Customer Requests",
    "collection":"customer_requests",
    "systemFields":[
      "created_at",
      "updated_at",
      "created_by",
      "updated_by"
    ]
  }'
```

Add a field:

```bash
curl 'http://localhost:3008/schema/collections/customer_requests/fields' \
  -X POST \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"Title",
    "field":"title",
    "type":"string",
    "length":255,
    "required":true
  }'
```

Create data:

```bash
curl 'http://localhost:3008/items/customer_requests' \
  -X POST \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"title":"New quote request"}'
```

Human-readable labels and stable API/database keys are separate. Changing the label later does not silently rename the REST collection/field key.

Read **[Data Model Guide](docs/data-model.md)** for field types, defaults, system fields, singletons and all relation types.

# Query the Items API

Every project collection has the normal CRUD surface:

```text
GET    /items/:collection
GET    /items/:collection/:id
POST   /items/:collection
PATCH  /items/:collection/:id
DELETE /items/:collection/:id
```

## Select fields and relations

Specific fields:

```text
GET /items/articles?fields=id,title,status
```

All readable scalar fields:

```text
GET /items/articles?fields=*
```

A relation field:

```text
GET /items/articles?fields=id,title,author_id.name
```

All readable fields inside a relation:

```text
GET /items/articles?fields=id,title,author_id.*
```

All readable root fields and readable first-level relations:

```text
GET /items/articles?fields=*.*
```

Nested relation paths are supported within documented depth/cost limits:

```text
GET /items/articles?fields=id,author_id.company_id.country_id.name
```

## Filter

```bash
curl --get 'http://localhost:3008/items/orders' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'filter={"status":{"_in":["paid","processing"]},"total":{"_gte":1000}}'
```

Supported comparison/text/null operators include:

```text
_eq  _neq  _lt  _lte  _gt  _gte
_in  _nin  _null  _nnull
_contains  _starts_with  _ends_with
```

Nested boolean logic uses `_and` and `_or`.

## Search, sort and paginate

```bash
curl --get 'http://localhost:3008/items/customers' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'search=acme' \
  --data-urlencode 'sort=-created_at,name' \
  --data-urlencode 'limit=25' \
  --data-urlencode 'offset=0'
```

## Aggregate and group

```bash
curl --get 'http://localhost:3008/items/orders' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'aggregate={"count":"*","sum":"total","avg":"total"}' \
  --data-urlencode 'groupBy=status'
```

Supported aggregate functions are `count`, `countDistinct`, `sum`, `avg`, `min` and `max`.

The complete grammar, exact limits, relation behavior and error cases are documented in **[Items API Query Language](docs/api-query-language.md)**.

# Roles, permissions and Public access

Access is deny-by-default. Project collection permissions can control:

- `read`, `create`, `update`, `delete`;
- readable/writable field allowlists;
- server-side row filters;
- prospective create/update validation.

A caller's filter is combined with the permission row filter using `AND`; query parameters do not replace RBAC.

The Public role follows the same explicit grant model. You can intentionally expose a collection or a filtered subset of Files without making unrelated resources public.

Read **[Roles and Permissions](docs/permissions.md)**.

# Files

YunCMS Files supports:

- gallery/list browsing in Studio;
- local storage;
- S3-compatible storage;
- raw binary upload;
- metadata edit;
- permission-aware download;
- image/media previews in Studio;
- File/Image collection fields;
- administrative storage reconciliation.

Example upload:

```bash
curl 'http://localhost:3008/files?storage=local' \
  -X POST \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/octet-stream' \
  -H 'X-Filename: product-photo.png' \
  -H 'X-Mimetype: image/png' \
  --data-binary '@./product-photo.png'
```

Read **[Files and Storage](docs/files.md)**.

# Authentication

YunCMS supports:

- email/password sessions;
- rotating refresh credentials;
- static API tokens;
- logout / logout-all;
- password reset;
- email verification;
- optional public self-registration with a server-controlled role;
- OIDC;
- OAuth2;
- LDAP;
- SAML.

Read **[Authentication](docs/auth.md)**, **[Public Registration](docs/public-registration.md)** and **[Configuration](docs/configuration.md)**.

# Extensions

Trusted JavaScript extensions can add:

- `/extensions/:id` HTTP endpoints;
- pre-mutation filters;
- post-mutation actions;
- startup lifecycle handlers;
- five-field cron scheduled jobs.

Scheduled jobs can run per process or in `singleton` mode using a MySQL advisory lock so only one replica performs the job.

Read **[Extensions](docs/extensions.md)**.

# AI assistant and MCP

The optional Studio AI assistant operates through the current user's normal YunCMS accountability. Data-changing tools require both Administrator-level feature enablement and the user's selected access mode; neither grants permissions the role does not already have.

Read **[AI Assistant](docs/ai-assistant.md)**.

The optional MCP endpoint exposes bounded schema/data tools through the same service/RBAC layer. It is disabled and read-only by default; Administrators configure it under **Settings → MCP Connection** without editing `.env` or restarting YunCMS.

Read **[MCP](docs/mcp.md)**.

# Configuration and Redis

Single-process installations can keep permission-cache and rate-limit state in memory. Multi-replica installations can select Redis independently for:

- permission cache;
- global API rate limits;
- authentication rate limits.

Example:

```env
CACHE_STORE=redis
API_RATE_LIMIT_STORE=redis
AUTH_RATE_LIMIT_STORE=redis
REDIS_URL=redis://redis.internal:6379
REDIS_PREFIX=yuncms:production:
REDIS_REQUIRED=true
```

The full environment-variable reference is **[Configuration](docs/configuration.md)**.

# Documentation

The complete user/operator/integrator index is **[docs/README.md](docs/README.md)**.

## Getting started and administration

- **[Documentation index](docs/README.md)**
- **[Getting Started](docs/getting-started.md)**
- **[Setup and CLI](docs/setup-cli.md)**
- **[Using YunCMS Studio](docs/studio.md)**
- **[Configuration](docs/configuration.md)**
- **[Data Model Guide](docs/data-model.md)**
- **[Studio Customization](docs/studio-customization.md)**

## API and integrations

- **[REST API Reference](docs/rest-api.md)**
- **[Items API Query Language](docs/api-query-language.md)**
- **[Authentication](docs/auth.md)**
- **[Public Registration](docs/public-registration.md)**
- **[Roles and Permissions](docs/permissions.md)**
- **[Files and Storage](docs/files.md)**
- **[Extensions](docs/extensions.md)**
- **[MCP](docs/mcp.md)**
- **[AI Assistant](docs/ai-assistant.md)**

## Production and operations

- **[Deployment](docs/deployment.md)**
- **[Upgrades / Backup / Restore](docs/upgrades.md)**
- **[Security](docs/security.md)**
- **[Production Readiness](docs/production-readiness.md)**
- **[Database Operations](docs/database.md)**
- **[Architecture Reference](docs/architecture.md)**

# Production notes

For a production installation:

1. use HTTPS behind a correctly configured reverse proxy;
2. set `TRUST_PROXY_HOPS` to the exact trusted proxy depth;
3. keep database, SMTP, S3, Redis and external-auth secrets outside source control;
4. back up MySQL and local Files storage, or configure provider-level S3 backup/versioning;
5. preserve `.yuncms/ai-settings.key` when AI provider credentials are configured;
6. use Redis shared state where multiple API replicas require coherent cache/rate-limit behavior;
7. start MCP read-only and AI writes disabled until permissions have been verified with representative accounts;
8. use the managed backup/update flow for version changes.

See **[Deployment](docs/deployment.md)** and **[Production Readiness](docs/production-readiness.md)**.

# License

MIT.
