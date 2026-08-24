# YunCMS Documentation

This directory is the user, administrator, operator and integration reference for YunCMS. Start with the section that matches what you are trying to do.

## Start here

- [Setup and CLI](setup-cli.md) — create a project, configure MySQL, bootstrap the Administrator account, start the server, back up, restore and update.
- [Using Studio](studio.md) — sign in, manage content, build collections, work with Files, users, roles, permissions, appearance and the built-in AI assistant.
- [Configuration](configuration.md) — server, MySQL, Redis, rate limits, Files/S3, SMTP, external authentication and MCP settings.
- [Data model](data-model.md) — collections, fields, system fields, singletons and M2O/O2O/O2M/M2M relations.

## API and integrations

- [REST API reference](rest-api.md) — endpoint catalogue, authentication, CRUD, schema, Files, users, roles, permissions, audit, AI, MCP and extension endpoints.
- [Items query language](api-query-language.md) — `fields`, `*`, `*.*`, nested relations, `filter`, `search`, `sort`, `limit`, `offset`, `aggregate`, `groupBy`, `expand`, limits and examples.
- [Authentication](auth.md) — sessions, refresh rotation, API tokens, password reset, email verification, OIDC, OAuth2, LDAP and SAML.
- [Roles and permissions](permissions.md) — Public access, action grants, row filters, field allowlists, validation rules and system-resource delegation.
- [Files](files.md) — upload/download, gallery use, local and S3-compatible storage, public/filtered file access and reconciliation.
- [Extensions](extensions.md) — endpoint extensions, hooks, lifecycle events, scheduled jobs and the extension SDK.
- [MCP](mcp.md) — connect agents through the same query and RBAC model as REST.
- [AI assistant](ai-assistant.md) — configure the Studio assistant, provider privacy, read/write modes and permission boundaries.

## Studio administration

- [Studio customization](studio-customization.md) — project name, logo, favicon, accent color, theme and navigation presentation.
- [Using Studio](studio.md) — content operations, Data Model, Files, users, roles and permissions.

## Operations

- [Deployment](deployment.md) — production process, reverse proxy, TLS, environment and operational recommendations.
- [Upgrades](upgrades.md) — managed update, backup/restore safety and maintenance behavior.
- [Database operations](database.md) — MySQL requirements, backup concerns and database-level behavior.
- [Security](security.md) — authentication, authorization, headers, rate limiting, pressure control, request ids and secret handling.
- [Production readiness](production-readiness.md) — operator checklist before exposing a deployment to production traffic.
- [Architecture](architecture.md) — technical reference for operators and extension/integration authors who need to understand the service boundaries.

## Fast API examples

Read records with selected fields and a relation:

```bash
curl --get 'http://localhost:3008/items/articles' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-urlencode 'fields=id,title,author_id.name' \
  --data-urlencode 'filter={"status":{"_eq":"published"}}' \
  --data-urlencode 'sort=-created_at' \
  --data-urlencode 'limit=25'
```

Return all readable root fields and all readable first-level relations:

```text
GET /items/articles?fields=*.*
```

Aggregate records:

```text
GET /items/orders?aggregate={"count":"*","sum":"total"}&groupBy=status
```

For the exact supported syntax and safety limits, use the [Items query language](api-query-language.md) rather than guessing query behavior.

## Documentation contract

The guides in `docs/` describe behavior available on the main YunCMS release line. Temporary implementation plans, release scratchpads and internal task lists are intentionally kept outside the public documentation set.
