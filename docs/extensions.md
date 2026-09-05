# Extensions

YunCMS extensions are trusted server-side JavaScript packages. Use them to add HTTP endpoints, react to data lifecycle events or run scheduled server jobs without modifying the YunCMS core packages.

Extensions execute inside the API process and can receive service/database context. Install only code you trust.

## SDK

Install/use the extension SDK in an extension package:

```js
import {
  defineEndpoint,
  defineHook,
} from '@yunsoft/yuncms-extensions-sdk';
```

The SDK defines the public extension shape. Runtime services remain supplied by YunCMS so extensions use the same schema, authorization, hooks, Files storage and database process boundary as the main application.

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
- `id` uses URL-safe lowercase letters, numbers, `_` or `-` and is at most 64 characters;
- `entry` must resolve inside the extension package root;
- duplicate extension ids fail startup;
- manifest type and the default-exported SDK definition must match.

## Discovery

At startup YunCMS discovers:

1. local packages under `./extensions/*/package.json`;
2. installed dependencies, optional dependencies and development dependencies in the root project when they contain a valid `yuncms` manifest.

The default local directory is `extensions`.

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

### Actions

`action(event, handler)` runs after a successful mutation. Failed/rejected mutations do not emit a success action. For bulk creates, actions run after the transaction commits.

Hook event context carries the active accountability, collection/operation metadata, relevant keys/filters and hook-chain metadata in addition to the base runtime context.

## Startup events

```text
app.beforeStart
app.afterStart
```

`app.beforeStart` fires after extensions are loaded but before the HTTP server listens. `app.afterStart` fires after the server has successfully started listening.

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

## Related guides

- [REST API](rest-api.md)
- [Items query language](api-query-language.md)
- [Roles and permissions](permissions.md)
- [Files](files.md)
- [Architecture](architecture.md)
