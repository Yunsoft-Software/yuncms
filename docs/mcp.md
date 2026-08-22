# YunCMS MCP

YunCMS exposes an optional Model Context Protocol endpoint for agents that need to inspect schema and work with collection data through the same service/RBAC layer as REST.

The endpoint is intentionally disabled by default.

## Enable

```env
MCP_ENABLED=true
```

Default security posture:

```env
MCP_WRITES_ENABLED=false
MCP_REQUIRE_AUTHENTICATION=true
MCP_MAX_ITEMS=100
MCP_MAX_RESULT_BYTES=1000000
```

Allowed browser origins default to the configured Studio origin. Override with an exact comma-separated allowlist:

```env
MCP_ALLOWED_ORIGINS=https://studio.example.com,https://agent.example.com
```

Only `http`/`https` origins are accepted.

## Transport

MCP is mounted at:

```text
POST /mcp
```

The current implementation uses stateless Streamable HTTP semantics: every POST gets a fresh MCP server/transport instance and YunCMS does not depend on an in-memory MCP session.

GET/SSE/session-style transport is not part of the current contract.

## Authentication

By default the endpoint requires ordinary YunCMS authentication:

```http
Authorization: Bearer <session-access-token-or-api-token>
```

The resolved YunCMS accountability is passed into every service used by MCP tools. MCP does not create an administrator identity and does not call YunCMS HTTP endpoints from inside the same process.

Setting:

```env
MCP_REQUIRE_AUTHENTICATION=false
```

allows Public accountability instead. This should only be used when the Public role has intentionally bounded permissions suitable for the exposed tools.

## Read tools

### `schema.list_collections`

Lists non-system collections the current identity may read.

### `schema.describe_collection`

Returns the readable collection shape, direct relation metadata and whether create/update/delete are allowed for the current identity.

Input:

```json
{
  "collection": "articles"
}
```

### `items.read_many`

Reads collection rows through the normal query and relation-expansion layer.

Example input:

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

Supported arguments mirror the implemented Items query layer: `fields`, `expand`, scalar `filter`, `search`, scalar `sort`, `aggregate`, `groupBy`, `limit`, and `offset`.

MCP applies its own maximum item count on top of core query limits.

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

Write tools are not registered unless explicitly enabled:

```env
MCP_WRITES_ENABLED=true
```

Available tools then include:

- `items.create`
- `items.update`
- `items.delete`

These call `ItemsService` directly with the request accountability. Normal create/update/delete permissions, field allowlists, validation rules, row filters, system-field behavior, hooks, and audit behavior remain authoritative.

Delete is marked destructive in MCP tool metadata.

## Result limits

Serialized MCP tool results are capped by:

```env
MCP_MAX_RESULT_BYTES=1000000
```

Oversized results return a bounded `MCP_RESULT_TOO_LARGE` tool error instead of returning an arbitrarily large payload.

To-many relation expansion also retains the core relation-row and query-cost limits documented in [`api-query-language.md`](api-query-language.md).

## Failure behavior

Known safe query/permission errors are returned to the tool caller with their bounded YunCMS code/message. Unexpected internal errors are normalized to `INTERNAL_ERROR`; raw stack traces and secrets are not returned as tool content.

## Recommended production configuration

Start read-only:

```env
MCP_ENABLED=true
MCP_WRITES_ENABLED=false
MCP_REQUIRE_AUTHENTICATION=true
MCP_ALLOWED_ORIGINS=https://studio.example.com
```

Use a dedicated normal YunCMS user/API token whose role contains only the collections/actions the agent needs. Do not give an agent Administrator merely to make MCP work.

Before enabling write tools in production, complete the MCP real-runtime checks in `todo.md`.
