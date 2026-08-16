# Extensions

YunCMS V1 extensions are trusted server-side JavaScript packages. The API is intentionally small and Directus-inspired: endpoint packages receive an Express router plus context, while hook packages register filter/action/init handlers.

There is no untrusted marketplace sandbox in V1.

## SDK

Use `@yuncms/extensions-sdk`:

```js
import { defineEndpoint, defineHook } from '@yuncms/extensions-sdk';
```

The SDK only marks/validates an extension definition. Runtime services stay in the API/core packages rather than being duplicated in the SDK.

## Package manifest

Each extension package has a `package.json` with a `yuncms` block:

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

Current manifest rules:

- type is `endpoint` or `hook` only;
- id is URL-safe (`a-z`, numbers, `_`, `-`, maximum 64 chars);
- entry must resolve inside the package root;
- duplicate extension ids fail startup;
- manifest type and default-exported SDK definition type must match.

## Discovery

At API startup YunCMS discovers:

1. local packages under `./extensions/*/package.json`;
2. installed root-project dependencies/optionalDependencies/devDependencies that contain a `yuncms` manifest.

The default local directory is `extensions`. Example packages live under `examples/extensions` and are not automatically loaded.

Extension discovery/loading happens after required DB migration compatibility succeeds and before the API begins listening. A malformed extension therefore fails startup rather than leaving a partially running extension set.

## Endpoint extensions

Example:

```js
import { defineEndpoint } from '@yuncms/extensions-sdk';

export default defineEndpoint((router, context) => {
  router.get('/', async (req, res) => {
    const schema = await context.getSchema();

    res.json({
      data: {
        user: req.accountability?.user ?? null,
        schema_version: schema.version
      }
    });
  });
});
```

An endpoint extension with id `orders` is mounted at:

```text
/extensions/orders
```

Extension routers are mounted after authentication middleware, so `req.accountability` and `req.context` are available.

Static endpoint context currently exposes:

- `services`
- `database`
- `logger`
- `env`
- `emitter`
- `getSchema()`
- `getAccountability(req)`
- `serviceOptions(req)`

### Calling YunCMS services

Do not make an HTTP request back to YunCMS from an extension running in the same process.

Use the service registry/context directly:

```js
export default defineEndpoint((router, context) => {
  router.get('/orders', async (req, res) => {
    const ItemsService = context.services.ItemsService;
    const service = new ItemsService(
      'orders',
      await context.serviceOptions(req)
    );

    res.json({ data: await service.readMany() });
  });
});
```

This preserves the request accountability, schema snapshot, hooks and DB process boundary without self-request/auth-token forwarding complexity.

## Hook extensions

Example:

```js
import { defineHook } from '@yuncms/extensions-sdk';

export default defineHook(({ filter, action, init }) => {
  init('app.beforeStart', ({ logger }) => {
    logger.info?.('extension ready');
  });

  filter('items.create', (payload, context) => {
    if (context.collection !== 'articles') return payload;
    return {
      ...payload,
      title: payload.title?.trim()
    };
  });

  action('items.create', ({ key }, context) => {
    context.logger.info?.(`created ${context.collection}:${key}`);
  });
});
```

Current item events:

- `items.create`
- `items.update`
- `items.delete`

`filter` runs before the DB mutation and may transform the payload or throw to reject the operation. The transformed payload still goes through normal schema/RBAC/write-field validation.

`action` runs after the corresponding successful mutation. For bulk creates, actions run after the transaction commits. Failed/rejected mutations do not emit a success action.

Hook event context includes normal runtime context plus:

- active accountability;
- collection;
- operation name;
- relevant key/filter metadata;
- hook chain metadata.

## Init events

Currently emitted startup lifecycle events:

- `app.beforeStart`
- `app.afterStart`

`app.beforeStart` runs after extensions are loaded but before the HTTP server listens. `app.afterStart` runs after successful listen.

## Recursion protection

Hook dispatch uses `AsyncLocalStorage` to track one asynchronous hook chain without sharing recursion state between unrelated concurrent requests.

Each chain has:

- a chain id;
- depth;
- event stack.

Nested service calls from hooks are allowed, but the default maximum hook depth is 12. Exceeding it fails with `HOOK_RECURSION_LIMIT` rather than allowing an infinite self-trigger loop.

## Trust model

Extensions are currently trusted code with server-side access. They can receive the database/service context and execute inside the API process.

Do not install untrusted extensions. Marketplace sandboxing/process isolation is explicitly outside V1 scope.

## Examples

See:

- `examples/extensions/hello-endpoint`
- `examples/extensions/normalize-title-hook`

## Still pending

- extension enable/disable configuration;
- hot reload;
- scheduled-job API;
- stronger per-extension capability isolation;
- packaged/npm installation smoke test;
- real API tests proving extension service calls preserve accountability and never need self-HTTP.

Verification work that requires an installed dependency graph/running API is tracked in `todo.md`.
