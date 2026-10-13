# Extensions

YunCMS extensions are trusted server-side JavaScript packages. Use them to add HTTP endpoints, react to data lifecycle events or run scheduled server jobs without modifying the YunCMS core packages.

Extensions execute inside the API process and can receive service/database context. Install only code you trust.

## SDK

Install/use the extension SDK in an extension package:

```js
import {
  defineEndpoint,
  defineHook,
  ExtensionError,
} from '@yunsoft/yuncms-extensions-sdk';
```

The SDK defines the public extension shape. Runtime services remain supplied by YunCMS so extensions use the same schema, authorization, hooks, Files storage and database process boundary as the main application.

### Public business errors

Trusted endpoint extensions and filter hooks can reject a request with a typed `ExtensionError`. Use a public message that is safe to return to the caller:

```js
import { defineHook, ExtensionError } from '@yunsoft/yuncms-extensions-sdk';

export default defineHook(({ filter }) => {
  filter('items.create', (payload, context) => {
    if (context.collection === 'orders' && payload.status !== 'draft') {
      throw new ExtensionError('WORKFLOW_INITIAL_STATE_INVALID', 'New orders must start as drafts.', {
        status: 422,
        path: 'status',
      });
    }
    return payload;
  });
});
```

The constructor accepts `(code, message, { status = 400, path, cause } = {})`. Codes are uppercase identifiers with letters, digits and underscores, at most 64 characters. Status must be an integer from 400 to 499. An optional path identifies the rejected field. The standard API error envelope preserves the custom code, public message, path and request id; the cause is never included in the response. Native YunCMS error codes retain their documented HTTP status even inside an `ExtensionError`.

An ordinary exception with an unknown code remains a sanitized HTTP 500, even when it has `status` or `statusCode` properties. Use the SDK type to opt into public business errors. Rejected filter mutations do not proceed to the database write; action hooks run after a successful mutation and cannot undo it.

## Package manifest

Each package needs a `yuncms` block in `package.json`:

```json
{
  "name": "yuncms-extension-orders",
  "type": "module",
  "yuncms": {
    "id": "orders",
    "type": "endpoint",
    "entry": "./src/index.js"
  }
}
```

Manifest rules:

- `type` is `endpoint` or `hook`;
- endpoint manifests may opt into `"rawBody": true`. For JSON requests to that endpoint, `req.rawBody` is a Buffer containing the original bytes and `req.body` remains parsed JSON. The normal 1 MiB limit, authentication, request context and error handling apply. Signature verification must use `req.rawBody`, never reserialized JSON; the extension must validate its provider signature and replay policy before side effects. This option accepts identity content encoding only (compressed requests return 415), preserving received bytes. Other endpoint/core requests do not receive `rawBody`;
- `id` uses URL-safe lowercase letters, numbers, `_` or `-` and is at most 64 characters;
- `entry` must resolve inside the extension package root;
- duplicate extension ids fail startup;
- manifest type and the default-exported SDK definition must match.

## Discovery

At startup YunCMS discovers:

1. local packages under `./extensions/*/package.json`;
2. installed dependencies, optional dependencies and development dependencies in the root project when they contain a valid `yuncms` manifest.

The default local directory is `extensions`.

Local extension directories may be symlinks to trusted workspace packages outside the runtime directory. YunCMS resolves the package root before validating its manifest. For linked packages, the entry must resolve to a regular file inside that resolved root, including when the entry itself is a symlink. Duplicate ids still fail discovery. Dangling or inaccessible directory links fail startup with `INVALID_EXTENSION_PATH`; links to ordinary files are ignored. Missing or escaping linked entries fail with `INVALID_EXTENSION_MANIFEST`.

### Dependency lookup and failure contract

When discovering npm dependency extensions, YunCMS inspects root `dependencies`, `optionalDependencies`, and `devDependencies`. Package locations are resolved sequentially across node module lookup directories (`require.resolve.paths`), supporting direct installations, hoisted monorepo workspace dependencies, scoped packages, packages exporting only subpaths, and symlinked packages.

Installed packages lacking a `yuncms` manifest in their `package.json` are treated as ordinary dependencies and ignored.

Startup failure behavior is strict:

- **Missing required dependency**: If a declared dependency cannot be resolved, startup fails with `EXTENSION_PACKAGE_NOT_RESOLVED`.
- **Missing optional dependency**: Unresolvable packages listed in `optionalDependencies` are skipped silently without stopping startup.
- **Malformed manifest**: Packages with invalid extension types, ids not matching identifier rules, missing entries, or entries escaping the package root fail startup immediately with `INVALID_EXTENSION_MANIFEST`.
- **Duplicate identifiers**: Colliding extension ids across local or dependency extensions fail startup with `DUPLICATE_EXTENSION_ID`.

Example packages in the repository live under:

```text
examples/extensions/hello-endpoint
examples/extensions/normalize-title-hook
```

Examples are not loaded automatically.

Extension validation/loading completes before the API begins listening. A malformed extension therefore fails clearly at startup instead of producing a partially loaded extension set.

# Endpoint extensions

Create `src/index.js`:

```js
import { defineEndpoint } from '@yunsoft/yuncms-extensions-sdk';

export default defineEndpoint((router, context) => {
  router.get('/', async (req, res) => {
    const schema = await context.getSchema();

    res.json({
      data: {
        user: req.accountability?.user ?? null,
        schema_version: schema.version,
      },
    });
  });
});
```

An endpoint extension with id `orders` is mounted at:

```text
/extensions/orders
```

Extension routers run after YunCMS authentication middleware, so request accountability/context is available.

## Endpoint context

The context includes:

- `services` — service-class registry;
- `database` — current database pool/connection context;
- `logger` — structured logger;
- `env` — the unfiltered process environment, including extension-specific variables (not the parsed YunCMS core configuration);
- `emitter` — lifecycle event bus;
- `storage` — registered Files storage context when available;
- `getSchema()` — current schema snapshot;
- `getAccountability(req)` — accountability from a request;
- `serviceOptions(req)` — service constructor options preserving request scope.

## Use services, not self-HTTP

An extension running in YunCMS should not call the same YunCMS server over HTTP merely to read/write local data. Instantiate the service directly:

```js
import { defineEndpoint } from '@yunsoft/yuncms-extensions-sdk';

export default defineEndpoint((router, context) => {
  router.get('/orders', async (req, res) => {
    const ItemsService = context.services.ItemsService;
    const service = new ItemsService(
      'orders',
      await context.serviceOptions(req),
    );

    const rows = await service.readMany({
      fields: 'id,order_no,total',
      sort: '-created_at',
      limit: 25,
    });

    res.json({ data: rows });
  });
});
```

This preserves request accountability, permission-cache scope, schema snapshot, hooks and audit behavior without forwarding bearer credentials back to the same process.

Do not replace `serviceOptions(req)` with an Administrator/system context just to make an extension request pass. If the endpoint is acting for the current caller, retain that caller's accountability.

# Hook extensions

Hooks can register filters, actions, initialization handlers and scheduled jobs:

```js
import { defineHook } from '@yunsoft/yuncms-extensions-sdk';

export default defineHook(({ filter, action, init, schedule }) => {
  init('app.beforeStart', ({ logger }) => {
    logger.info?.('orders extension ready');
  });

  filter('items.create', (payload, context) => {
    if (context.collection !== 'articles') return payload;
    return {
      ...payload,
      title: payload.title?.trim(),
    };
  });

  action('items.create', ({ key }, context) => {
    context.logger.info?.(`created ${context.collection}:${key}`);
  });

  schedule(
    '0 * * * *',
    async ({ services, serviceOptions }) => {
      // Scheduled jobs run with explicitly declared system accountability.
      // Use services directly for local work.
    },
    {
      id: 'hourly-maintenance',
      accountability: 'system',
      mode: 'singleton',
      overlap: 'skip',
    },
  );
});
```

## Item events

Current item lifecycle events:

```text
items.create
items.update
items.delete
```

### Filters

`filter(event, handler)` runs before the database mutation. The handler can return a transformed payload or throw an error to reject the operation.

A transformed payload is still checked by normal schema, role, write-field and validation rules. A filter is not an authorization bypass.

Native user creation (including public registration), update and deletion also run `users.create`, `users.update` and `users.delete` filters. User filters receive the verified accountability, operation, immutable target `key`, request id and active transaction connection. Update/delete provide a safe `before` record. Public registration uses `users.create` with `operation: 'register'`, `publicRegistration: true` and the configured role in context; its returned payload still accepts only email/password and cannot change that role. User create/update payload transformations are revalidated, while delete filters are veto-only. A thrown filter error rolls back the mutation and any writes made through the active connection. User actions are deferred until the outer native transaction commits and are discarded on rollback. Use native `withTransaction` for multi-user atomic work; schema DDL cannot be grouped into a rollbackable bulk transaction.

Schema services expose veto-only filters: `schema.collection.create/update/delete`, `schema.field.create/update/delete`, and `schema.relation.create/delete`. They run after schema-manager authorization and input validation, inside the schema advisory lock and before DDL/metadata writes. Context contains `collection`, target `key`, operation, verified accountability, request id and the lock connection; physical field updates include `physical: true`, and relation operations include `kind`. Returning a value does not change schema targets or payloads. Throw an `ExtensionError` to reject native HTTP and direct service calls. Existing post-success schema actions remain available. Extensions enforcing concurrent quotas must serialize their policy reads/writes through the supplied connection; a count-only check is not a reservation.

Native file uploads expose a veto-only `files.create` admission filter before storage and metadata writes, with trusted `context.filesize`, actor identity and an active transaction connection. Use this connection for atomic application quota reservations and throw a typed error for rejection. File creation joins native outer transactions, cleans up blobs on rollback, and defers create actions until commit. See [Files](files.md) for the payload, context and storage compensation limits.

### Read query hooks

`filter('items.query', handler)` transforms the normalized query for root collection list reads and single-item reads, including `ItemsService.readOne()` and `GET /items/:collection/:id`. Its context contains `operation: 'read'`; single-item reads also provide `single: true` and `key` with the requested primary key. The hook output is parsed again and remains subject to query-cost and native field/row permissions.
External authentication JIT creation also uses the `users.create` gate with `externalRegistration: true`, `publicRegistration: true` and the provider id. This gate is veto-only: a returned payload cannot change the verified identity or configured JIT role. Rejection rolls back both user and identity creation; the safe user-create action runs only after commit. Linking an existing user does not create a user and does not run this gate.

For a single-item read, hook `fields`, `filter` and `search` affect the selected record. The requested primary key is enforced separately and cannot be replaced by the hook. Pagination and sorting do not change this lookup; aggregate output is rejected with `INVALID_QUERY`. A record excluded by the hook returns `null` from the service or HTTP 404 from the item endpoint. The read performed to return a created or updated item uses the same hook.

`items.query` does not run for internal batched relation expansion lookups. Use native permission row filters for constraints that must also protect expanded related records.

`action('items.read', handler)` receives bounded read metadata (`collection`, `query`, `keys`, `count`, `single`) rather than the response data. A single-item read excluded by a query hook does not emit this action.

### Actions

`action(event, handler)` runs after a successful mutation. Failed/rejected mutations do not emit a success action. For bulk creates, actions run after the transaction commits.

Hook event context carries the active accountability, collection/operation metadata, relevant keys/filters and hook-chain metadata in addition to the base runtime context.

For atomic Items mutations, bind the service to the connection supplied by the native transaction helpers:

```js
import { withTransaction } from '@yunsoft/yuncms-core';

await withTransaction(context.database, async (connection) => {
  const options = await context.serviceOptions(req);
  const items = new context.services.ItemsService('orders', { ...options, database: connection });
  await items.createOne({ title: 'New order' });
  // Other database mutations on this connection participate in the same transaction.
});
```

`withTransaction(pool, operation)` borrows and releases a connection. `withConnectionTransaction(connection, operation)` keeps connection ownership with the caller. Nested helper calls on an active managed connection join the outer transaction, without separate commits or savepoints; they cannot change its isolation level. Let failures escape the outer operation to roll back all its writes.

Native MySQL2 pool/connection item mutations automatically open or join a managed transaction, including single and bulk create/update/delete. Bulk pre-write staging runs inside that transaction. Items filters execute inside the transaction. Items success actions (including native audit writes and AI automation enqueueing) wait for the outer commit, preserve mutation order, and are discarded on rollback or commit failure. The helper waits for these actions before returning. Post-commit action failure cannot roll back data that has already committed; actions are best-effort effects rather than a durable event queue.

For Items mutation hooks, `context.database` is the active connection in filters and a usable post-commit database handle in actions. `context.transaction` is `{ managed: true, state: 'active' }` for transactional filters, `{ managed: true, state: 'committed' }` for deferred actions, and `null` only for non-transactional custom SQL adapters. Native MySQL2 mutation calls are transactional without an explicit outer helper. Read hooks still run at the read itself. Raw `beginTransaction()` calls outside the native helpers are not tracked; use the helpers for deferred action handling.

## Startup events

```text
app.beforeStart
app.afterStart
```

`app.beforeStart` fires after extensions are loaded but before the HTTP server listens. `app.afterStart` fires after the server has successfully started listening.

If binding the configured port fails (for example `EADDRINUSE`), startup exits with an error. `app.afterStart`, scheduled jobs and the AI automation worker do not start. Initialized resources are stopped through the normal shutdown path, including `app.beforeStop` and `app.afterStop` for a loaded extension runtime.

# Scheduled jobs

Hook extensions can register five-field cron schedules:

```text
minute hour day month weekday
```

Examples:

```text
*/5 * * * *     every 5 minutes
0 * * * *       every hour
0 2 * * *       daily at 02:00
0 9 * * 1-5     weekdays at 09:00
```

Supported cron syntax includes `*`, numeric values, comma lists, ranges and steps on `*`/ranges. Weekday is `0`–`6`.

Every scheduled job requires a stable id and an explicit system-accountability declaration:

```js
schedule('0 2 * * *', handler, {
  id: 'nightly-cleanup',
  accountability: 'system',
  mode: 'singleton',
  overlap: 'skip',
});
```

### Modes

`per_process` runs the job independently in each API process. Use it only when that behavior is intentional.

`singleton` uses a MySQL advisory lock so only one replica executes the matching scheduled job at a time. This is the preferred mode for a cluster-wide maintenance/integration task.

### Overlap

The supported overlap behavior is `skip`. If the previous invocation is still running, YunCMS skips the overlapping execution rather than starting another copy.

### Scheduled-job accountability

Scheduled jobs have no end-user request, so they must explicitly declare:

```js
accountability: 'system'
```

That is privileged execution. Keep scheduled handlers narrow, validate external inputs and avoid turning user-controlled records into arbitrary administrative instructions.

# Hook recursion protection

Hook dispatch tracks each asynchronous hook chain with `AsyncLocalStorage`. Nested service calls from hooks are allowed, but a chain has a bounded maximum depth (default 12). Excessive recursive triggering fails with `HOOK_RECURSION_LIMIT` instead of looping indefinitely.

Unrelated concurrent requests do not share hook-chain recursion state.

# Trust and security

Extensions are server code, not sandboxed user scripts. They may be able to access database/services/environment depending on context.

Operational rules:

- install only trusted packages;
- keep secrets in environment/configuration rather than source;
- preserve request accountability for request-driven endpoints;
- use system accountability only for jobs/actions that genuinely require it;
- validate data received from third-party webhooks/APIs;
- use YunCMS services instead of direct SQL for normal project-data operations so permissions, hooks and schema behavior remain consistent;
- avoid synchronous/blocking work that would stall the API process.

# Storage contract

Storage drivers provide the binary persistence layer used by `FilesService`. Custom drivers implement the storage interface:

```js
class CustomStorageDriver {
  async put(key, contents) {} // stores Buffer/Uint8Array
  async get(key) {}          // returns Buffer
  async delete(key) {}       // deletes object
  async stat(key) {}         // returns { key, size, modifiedAt } or null
  async getSignedUrl(key) {} // returns string or null
  // Optional:
  async getStream(key, { start, end } = {}) {} // returns Readable stream
}
```

### Streaming and fallback buffering

Built-in storage drivers implement streaming directly:
- `LocalStorageDriver` uses Node's `fs.createReadStream` with bounded chunk buffers (`highWaterMark`) and optional inclusive `{ start, end }`.
- `S3StorageDriver` passes byte ranges to `GetObjectCommand` via AWS SDK's `Range` header, returning the Node `Readable` body directly without memory buffering.

Custom and legacy storage drivers are **not required** to implement `getStream()`:
- When implemented, `getStream()` must return a Node `Readable` stream.
- When `getStream()` is omitted, `FilesService.readContentStream()` automatically falls back to buffering via `driver.get()` and streams the full buffer or subrange slice (`fullBuffer.subarray(start, end + 1)`) as a byte stream through `Readable.from()`.
- Metadata queries (`readContentInfo()`, HTTP `HEAD`) use `driver.stat()` and never open or buffer the file body.

## Related guides

- [REST API](rest-api.md)
- [Items query language](api-query-language.md)
- [Roles and permissions](permissions.md)
- [Files](files.md)
- [Architecture](architecture.md)

## AI policy lifecycle

Native AI chat authentication and tool authorization remain in the API. Hook-enabled assistant instances dispatch veto-only admission filters before provider work. Admission filter return values do not change caller write/delete flags.

- `ai.chat.before`: request messages, locale and caller access flags; throw a typed error to deny the chat.
- `ai.chat.completed`: successful final message, operations and aggregate usage; a filter may add a receipt or reject completion persistence.
- `ai.chat.failed`: error code, including admission/completion failures.
- `ai.provider.before`: one provider round's server-generated `call_id`, configured maximum output and conservative `estimated_max_tokens` (UTF-8 input/tool bytes plus output and protocol allowance). Reserve application capacity here.
- `ai.provider.completed`: the same `call_id` and `usage: { totalTokens, estimated }`. Reconcile the reservation before the round returns.
- `ai.provider.failed`: the same `call_id` and safe error code; release unfinished reservations. A later chat/tool failure does not undo provider rounds that have already completed.

Context carries the verified caller, request id, native database/schema/services and storage through normal request service options. Provider credentials are absent from payloads. `totalTokens` uses reported non-negative integer usage when available; otherwise it is an explicitly marked estimate. Native HTTP chat responses expose aggregate `usage: { total_tokens, estimated }`. Internal assistant instances without a hook emitter retain the previous response shape.

Business ledgers, reservations, expiry and failure recovery belong to extensions. Hooks alone do not provide a durable event queue or guarantee exact provider billing; preserve pending reservations and reconciliation evidence across crashes.
