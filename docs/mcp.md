# YunCMS MCP

YunCMS exposes an optional Model Context Protocol endpoint for agents that need to inspect schema and work with collection data through the same service/RBAC layer as REST.

MCP is disabled, authenticated and read-only by default. All MCP configuration is stored in YunCMS and managed by an Administrator in **Studio → Settings → MCP Connection**. `MCP_*` environment variables are not part of the runtime configuration contract.

## Configure in Studio

The MCP settings screen controls:

- whether `POST /mcp` is enabled;
- whether create, update and delete tools are registered;
- whether clients must authenticate with a YunCMS access token;
- exact allowed Host and browser Origin values;
- maximum items per read and maximum serialized tool-result size.

Saved changes apply to the next MCP request without restarting the API process.

Before enabling the endpoint, add at least one exact Host value. Use `host` or `host:port`, not a URL:

```text
api.example.com
localhost:3008
```

Allowed browser origins must be exact `http` or `https` origins:

```text
https://studio.example.com
https://agent.example.com
```

Origin validation protects browser-originated MCP requests. Host validation also applies to non-browser clients and helps prevent DNS-rebinding attacks against the listener. Behind a reverse proxy, save the public Host header actually forwarded to YunCMS.

## Transport

The Streamable HTTP endpoint is:

```text
POST /mcp
```

The endpoint is stateless: every POST gets a fresh MCP server/transport instance and YunCMS does not depend on an in-memory MCP session. GET/SSE/session-style transport is not part of the current contract.

When disabled, the runtime endpoint returns `404` with `MCP_DISABLED`; the Administrator settings route remains available.

## Authentication

With **Require YunCMS authentication** enabled, clients send an ordinary session access token or API token:

```http
Authorization: Bearer <session-access-token-or-api-token>
```

The resolved YunCMS accountability is passed into every service used by MCP tools. MCP does not create an Administrator identity and does not call YunCMS HTTP endpoints from inside the same process.

An Administrator may explicitly disable authentication. Requests then use Public accountability, so the Public role must contain only the deliberately exposed collections, fields, rows and actions. Host and Origin validation continue to apply.

## Read tools

### `schema.list_collections`

Lists non-system collections the current identity may read.

### `schema.describe_collection`

Returns the readable collection shape, direct relation metadata and whether create/update/delete are allowed for the current identity.

```json
{
  "collection": "articles"
}
```

### `items.read_many`

Reads collection rows through the normal query and relation-expansion layer.

```json
{
  "collection": "articles",
  "fields": "id,title,author_id.name,tags.name",
  "filter": {
    "status": { "_eq": "published" }
  },
  "search": "YunCMS",
  "sort": "-created_at",
  "limit": 25,
  "offset": 0
}
```

Supported arguments mirror the Items query layer: `fields`, `expand`, scalar `filter`, `search`, scalar `sort`, `aggregate`, `groupBy`, `limit`, and `offset`. The panel’s maximum-item setting applies on top of core query limits.

### `items.read_one`

Reads one item by id with normal field/relation selection.

```json
{
  "collection": "articles",
  "id": "...",
  "fields": "id,title,author_id.name"
}
```

## Write tools

Write tools are absent unless an Administrator enables **Data-changing tools**:

- `items.create`
- `items.update`
- `items.delete`

These call `ItemsService` directly with request accountability. Normal create/update/delete permissions, field allowlists, validation rules, row filters, system-field behavior, hooks and audit behavior remain authoritative. Delete is marked destructive in MCP tool metadata.

Enabling the tools does not grant permissions by itself. A client can only perform actions allowed to the connected YunCMS user or, when authentication is disabled, to the Public role.

## Result limits

The serialized result byte limit is configured in the panel. Oversized results return a bounded `MCP_RESULT_TOO_LARGE` tool error. To-many relation expansion also retains the core relation-row and query-cost limits documented in [Items query language](api-query-language.md).

## Failure behavior

Known safe query and permission errors are returned with their bounded YunCMS code/message. Unexpected internal errors become `INTERNAL_ERROR`; raw stack traces and secrets are not returned as tool content.

Invalid request hosts fail with `MCP_HOST_FORBIDDEN`. Invalid browser origins fail with `MCP_ORIGIN_FORBIDDEN`. These checks happen before tool execution.

## Recommended production setup

Start from the panel with:

- MCP enabled;
- data-changing tools disabled;
- YunCMS authentication required;
- only the deployed API Host and required browser origins allowed;
- a dedicated normal YunCMS user/API token whose role contains only the collections and actions the integration needs.

Do not give an integration Administrator merely to make MCP work. Before enabling write tools in production, test the actual identity against representative create/update/delete permissions, row filters and field allowlists in a non-production collection.

## Related guides

- [Configuration](configuration.md)
- [Items query language](api-query-language.md)
- [Roles and permissions](permissions.md)
- [Security](security.md)
