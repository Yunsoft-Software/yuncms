# YunCMS Documentation

This is the user, administrator, operator and integration reference for YunCMS. You do not need to read it in file order: choose the outcome you want, complete the linked guide and return here for the next task.

## New to YunCMS?

Follow [Getting Started](getting-started.md) from an empty directory to a running Studio, first collection, restricted role and authenticated API request.

<p align="center">
  <img src="assets/screenshots/studio-content.png" alt="YunCMS Content workspace" width="100%">
</p>

## Find the right guide

| Your goal | Read this | What you will learn |
| --- | --- | --- |
| Evaluate or install YunCMS | [Getting Started](getting-started.md) | Requirements, npm installation, first collection, editor role and first API call. |
| Operate the browser interface | [Using Studio](studio.md) | Content, Data Model, Files, users, permissions, branding, AI and mobile navigation. |
| Configure the server | [Configuration](configuration.md) | MySQL, Files, SMTP, Redis, auth providers, rate limits and deployment URLs. |
| Build a data model | [Data Model](data-model.md) | Fields, system fields, relations, singletons, groups, ordering and visibility. |
| Secure access | [Roles and Permissions](permissions.md) | Deny-by-default actions, fields, row filters, validation and Public access. |
| Connect an application | [REST API](rest-api.md) | Authentication, CRUD, schema, Files and system endpoints. |
| Query content safely | [Items Query Language](api-query-language.md) | Fields, relations, filters, search, sorting, pagination and aggregation. |
| Put YunCMS in production | [Production Readiness](production-readiness.md) | Preflight checklist, backups, storage, proxy, security and upgrade verification. |

## Start here

- [Getting Started](getting-started.md) — install YunCMS and complete a guided first project in about 15 minutes.
- [Setup and CLI](setup-cli.md) — create a project, configure MySQL, bootstrap the Administrator account, start the server, back up, restore and update.
- [Using Studio](studio.md) — sign in, manage content, build collections, work with Files, users, roles, permissions, appearance and the built-in AI assistant.
- [Configuration](configuration.md) — server, MySQL, Redis, rate limits, Files/S3, SMTP, external authentication and MCP settings.
- [Data model](data-model.md) — collections, fields, system fields, singletons and M2O/O2O/O2M/M2M relations.

## API and integrations

- [REST API reference](rest-api.md) — endpoint catalogue, authentication, CRUD, schema, Files, users, roles, permissions, audit, AI, MCP and extension endpoints.
- [Items query language](api-query-language.md) — `fields`, `*`, `*.*`, nested relations, `filter`, `search`, `sort`, `limit`, `offset`, `aggregate`, `groupBy`, `expand`, limits and examples.
- [Authentication](auth.md) — sessions, refresh rotation, API tokens, password reset, email verification, OIDC, OAuth2, LDAP and SAML.
- [Public registration](public-registration.md) — default-off signup, role assignment, optional email verification and resend behavior.
- [Roles and permissions](permissions.md) — Public access, action grants, row filters, field allowlists, validation rules and system-resource delegation.
- [Files](files.md) — upload/download, gallery use, local and S3-compatible storage, public/filtered file access and reconciliation.
- [Extensions](extensions.md) — endpoint extensions, hooks, lifecycle events, scheduled jobs and the extension SDK.
- [MCP](mcp.md) — connect agents through the same query and RBAC model as REST.
- [AI assistant](ai-assistant.md) — configure the Studio assistant, provider privacy, read/write modes and permission boundaries.

## Studio administration

- [Studio customization](studio-customization.md) — project name, logo, favicon, accent color, theme and navigation presentation.
- [Public registration](public-registration.md) — configure controlled account signup from Branding & Appearance.
- [Using Studio](studio.md) — content operations, Data Model, Files, users, roles and permissions.

## Visual tour

| Content | Data Model |
| --- | --- |
| ![Content records](assets/screenshots/studio-content.png) | ![Data Model navigation editor](assets/screenshots/studio-data-model.png) |
| Search, filter, sort and edit records with role-aware actions. | Group collections, drag to reorder and use the crossed eye for hidden collections. |

| Files | Permissions |
| --- | --- |
| ![Files gallery](assets/screenshots/studio-files.png) | ![Permission matrix](assets/screenshots/studio-permissions.png) |
| Preview and manage local or S3-compatible assets. | Grant simple actions or open advanced field/row/write restrictions. |

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
