# YunCMS

**A fast, programmable MySQL CMS/backend with a focused React Studio, strong RBAC and an API you can understand without reverse-engineering the product.**

YunCMS is an independent, Directus-inspired backend project from **Yunsoft**. The goal is not to reproduce every feature of a giant headless CMS. The goal is to make the high-value parts — dynamic collections, fields, relations, permissions, Files, authentication and extensions — clean enough to build real products on top of them.

> YunCMS is currently pre-stable (`0.1.x`). The API and Studio are moving quickly. Use the documented migration/bootstrap and managed upgrade flow, and verify the current release checklist before production deployment.

---

## Why YunCMS?

Most applications need the same foundation:

- a database schema that can evolve without writing a custom admin panel every week;
- a usable place for operators to manage data;
- a REST API with real filtering, sorting and pagination;
- authentication and role-based access control;
- file storage and previews;
- relations that are actually enforced by the database;
- enough extension points to add product-specific behavior without forking the core.

YunCMS puts those pieces behind a deliberately small architecture:

```text
React Studio
    │
    ▼
Express REST API
    │
    ▼
Core services + accountability + RBAC
    │
    ▼
mysql2/promise
    │
    ▼
MySQL
```

No GraphQL layer. No ORM abstraction. No second SQL dialect hidden in the codebase.

---

# What you get

## Dynamic Data Model

Create project collections, fields and relations from Studio or through the Schema API.

Supported field families include:

- short text / long text;
- integer / bigint / decimal;
- boolean;
- date / datetime / timestamp;
- JSON;
- UUID;
- semantic File / Image references.

Relations:

- many-to-one;
- one-to-one with a physical `UNIQUE` constraint;
- many-to-many through a managed junction collection.

YunCMS uses schema locks, explicit validation and compensation logic around dynamic DDL instead of pretending MySQL DDL behaves like ordinary application transactions.

## Human names without ugly database identifiers

Your editors should not have to name a field `urun_fiyati` just because MySQL and REST need a stable identifier.

In Studio you can write:

```text
Ürün Fiyatı
```

YunCMS suggests:

```text
urun_fiyati
```

Both are stored separately:

```json
{
  "name": "Ürün Fiyatı",
  "field": "urun_fiyati"
}
```

The same applies to collections:

```text
Müşteri Talepleri  →  musteri_talepleri
İçecek Ölçüsü      →  icecek_olcusu
2026 Ürünleri      →  collection_2026_urunleri
```

Display names may later change without silently renaming your physical tables, columns, URLs or integration payloads.

## REST-first Items API

Every project collection becomes a resource:

```text
GET    /items/:collection
GET    /items/:collection/:id
POST   /items/:collection
PATCH  /items/:collection/:id
DELETE /items/:collection/:id
```

Example:

```bash
curl --get 'http://localhost:3008/items/orders' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'fields=id,order_no,total,status,created_at' \
  --data-urlencode 'filter={"status":{"_in":["paid","processing"]},"total":{"_gte":1000}}' \
  --data-urlencode 'sort=-created_at' \
  --data-urlencode 'limit=25' \
  --data-urlencode 'offset=0'
```

The API supports:

- field selection;
- server-side filtering;
- nested `_and` / `_or` logic;
- equality and comparison operators;
- `_in` / `_nin`;
- NULL checks;
- contains / starts-with / ends-with text search;
- multi-column sorting;
- limit/offset pagination;
- direct relation expansion.

See **[Items API Query Language](docs/api-query-language.md)** for the complete grammar and examples.

## RBAC that is part of the query, not a UI decoration

Project collection permissions support:

- read;
- create;
- update;
- delete;
- field allowlists;
- row filters;
- create/update validation rules.

User filters are combined with role filters rather than replacing them. Requesting `fields=*`, using `_or`, sorting or expanding a relation does not bypass permissions.

The Public role exists but is **deny-by-default**.

Selected system resources also have bounded delegation:

- Users: explicit action-level delegation with protected-account/role invariants;
- Files: explicit CRUD delegation, with an optional server-side row filter on `read`;
- Roles: explicit CRUD delegation while Administrator/Public invariants remain service-enforced;
- internal sessions/tokens/permissions/audit stay closed.

## Files that behave like a real library

YunCMS supports:

- local filesystem storage;
- S3-compatible storage;
- upload/list/read/update/delete;
- safe physical storage keys;
- reconciliation tooling;
- gallery and list views;
- search/filter/sort/pagination;
- full-size preview modal;
- image, PDF, video and audio preview;
- File/Image field pickers in Content.

Branding assets are selected from Files too. Logo and favicon pickers open a searchable, paginated modal instead of dumping the entire file library into the settings form.

## Studio branding

Studio supports:

- brand name;
- custom logo selected from Files;
- custom favicon selected from Files;
- accent color;
- Light / Dark / System theme;
- English / Turkish default language;
- personal language override.

When no custom branding asset is selected, YunCMS falls back to Yunsoft defaults.

## Extensions

The extension SDK provides trusted server-side extension entry points such as:

```js
import { defineEndpoint } from '@yunsoft/yuncms-extensions-sdk';

export default defineEndpoint({
  id: 'hello',
  handler(router, context) {
    router.get('/', async (req, res) => {
      res.json({
        message: 'Hello from YunCMS',
        user: req.accountability.user,
      });
    });
  },
});
```

Extensions reuse YunCMS services/accountability instead of making HTTP requests back into the same process.

---

# Requirements

YunCMS currently targets:

```text
Node.js 24 LTS
npm 11+
MySQL 8-compatible server
```

The repository intentionally rejects unsupported Node major versions rather than hoping they work.

---

# Quick start

From the repository:

```bash
npm install
npm run init
npm run bootstrap
npm start
```

Default local URL:

```text
http://localhost:3008
```

The same Express listener serves both the REST API and the built Studio.

The published CLI package is:

```text
@yunsoft/yuncms
```

Package-level commands:

```text
yuncms init
yuncms bootstrap
yuncms start
yuncms backup
yuncms restore /path/to/backup --yes
yuncms update --dry-run
yuncms update --to <version>
yuncms help
```

Fresh init uses port **3008** consistently for the server, Studio origin and public auth URL.

Production updates are maintenance-window based in the current V1. Stop the service supervisor first; managed update performs preflight, a mandatory verified backup, exact npm package install, target migrations, a temporary `/ready` probe and automatic rollback when a post-backup step fails. S3 object backup remains the deployment provider's responsibility.

Development/source validation:

```bash
npm run dev
npm run test:fast
npm test
npm run test:release
```

`test:release` also builds Studio and verifies publishable package contracts. Real MySQL integration checks are opt-in so ordinary source tests remain fast.

Read: [Setup CLI](docs/setup-cli.md) · [Production upgrades](docs/upgrades.md)

---

# Build your first collection

Use Studio, or call the Schema API directly.

```bash
curl 'http://localhost:3008/schema/collections' \
  -X POST \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Müşteri Talepleri",
    "collection": "musteri_talepleri",
    "note": "Müşterilerden gelen destek ve teklif talepleri",
    "metadata": {
      "icon": "inbox",
      "sort": 10
    },
    "systemFields": [
      "created_at",
      "updated_at",
      "created_by",
      "updated_by"
    ]
  }'
```

Add a field:

```bash
curl 'http://localhost:3008/schema/collections/musteri_talepleri/fields' \
  -X POST \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Başlık",
    "field": "baslik",
    "type": "string",
    "length": 255,
    "required": true
  }'
```

Add another:

```bash
curl 'http://localhost:3008/schema/collections/musteri_talepleri/fields' \
  -X POST \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Öncelik",
    "field": "oncelik",
    "type": "integer"
  }'
```

Then create data through the Items API:

```bash
curl 'http://localhost:3008/items/musteri_talepleri' \
  -X POST \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "baslik": "Yeni fiyat teklifi",
    "oncelik": 8
  }'
```

The separation is deliberate:

```text
Studio display name: Müşteri Talepleri
API / MySQL key:    musteri_talepleri
```

---

# Query examples

Published articles, newest first:

```bash
curl --get 'http://localhost:3008/items/articles' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'filter={"status":{"_eq":"published"}}' \
  --data-urlencode 'sort=-published_at'
```

Price range:

```bash
curl --get 'http://localhost:3008/items/products' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'filter={"price":{"_gte":100,"_lte":500}}'
```

Search title:

```bash
curl --get 'http://localhost:3008/items/articles' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'filter={"title":{"_contains":"YunCMS"}}'
```

OR condition:

```bash
curl --get 'http://localhost:3008/items/tasks' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'filter={"_or":[{"priority":{"_gte":8}},{"featured":{"_eq":true}}]}'
```

Expand a direct relation:

```bash
curl --get 'http://localhost:3008/items/articles' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'fields=id,title,author_id' \
  --data-urlencode 'expand=author_id'
```

There is a full operator table, nested filter examples and JavaScript examples in [API Query Language](docs/api-query-language.md).

---

# Repository layout

```text
apps/
  studio/                 React Studio

packages/
  api/                    Express REST API
  cli/                    @yunsoft/yuncms CLI
  core/                   schema, auth, RBAC, Files, services
  extensions-sdk/         extension helpers

scripts/
  verify.mjs              low-noise source/release test runner

docs/                     architecture and API documentation
```

---

# Architecture principles

### Service authorization, not route-only authorization

Sensitive checks live in core services. A trusted extension cannot simply instantiate a service with ordinary user accountability and bypass schema/RBAC rules that only existed in Express middleware.

### No self-request architecture

Internal code does not make HTTP requests back into YunCMS to reuse functionality. Extensions and routes call the same service layer directly.

### Explicit dynamic DDL

Schema changes are serialized with an advisory lock. MySQL DDL failures and metadata failures use explicit compensation strategies. Core upgrade migrations additionally record in-progress/failed attempts so partially committed DDL is never blindly retried.

### Stable API identifiers

Human-facing labels are free to evolve; machine keys remain stable integration contracts.

### Fail closed

Unknown fields, query parameters, filter operators and internal system resources are rejected instead of guessed.

---

# Documentation

## API

- **[REST API Reference](docs/rest-api.md)** — complete endpoint map and request examples.
- **[Items API Query Language](docs/api-query-language.md)** — fields, filters, operators, sort, pagination, expand and JavaScript examples.
- [Authentication](docs/auth.md)
- [Permissions / RBAC](docs/permissions.md)
- [Files / storage](docs/files.md)

## Architecture / operations

- [Architecture](docs/architecture.md)
- [Database & schema engine](docs/database.md)
- [Development](docs/development.md)
- [Extensions](docs/extensions.md)
- [Setup CLI](docs/setup-cli.md)
- [Production upgrades / backup / restore](docs/upgrades.md)
- [Security](docs/security.md)
- [Deployment](docs/deployment.md)
- [Production readiness](docs/production-readiness.md)
- [Production readiness test plan](docs/production-readiness-test-plan.md)
- [Publishing](docs/publishing.md)
- [Studio customization](docs/studio-customization.md)

---

# Current status

YunCMS already has a substantial source surface, but `0.1.x` should still be treated as active development.

Before calling a specific commit production-ready, run the repository release gates and the environment-specific checks tracked in `todo.md` against the actual Node 24/MySQL/storage/browser environment you intend to deploy.

The project intentionally keeps that distinction visible: **source-complete is not the same claim as deployment-verified**.

---

# License

MIT.
