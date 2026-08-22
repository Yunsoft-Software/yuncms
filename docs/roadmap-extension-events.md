# Extension Events and Scheduling — Implemented Source Boundary

Target baseline: `22-08-2026`.

Completed roadmap phases have been removed. There is currently **no pending source task required by the original extension-event roadmap**. Environment-dependent multi-process/runtime checks remain in `todo.md`.

## Hook model

Trusted hook extensions receive:

```js
export default defineHook(({ filter, action, init, schedule }) => {
  // ...
});
```

Registration is deterministic:

1. higher integer priority first;
2. stable extension id tie-breaker;
3. registration order as the final tie-breaker.

Hook chains use `AsyncLocalStorage` metadata with a bounded recursion depth. Concurrent requests do not share chain state.

## Filter semantics

Filters may transform a normalized value before the core operation continues. The transformed value is not blindly trusted.

Important examples:

- `items.query` — receives the normalized query object; YunCMS parses/validates it again and recalculates query cost before applying RBAC/SQL;
- `items.create`, `items.update`, `items.delete` — mutation interception; normal schema/field/RBAC/validation behavior still follows;
- Files metadata create/update interception where supported by `FilesService`;
- `mail.send` — bounded message transformation before transport validation/sending.

An extension filter does not become a raw-SQL escape hatch.

## Action events

Action handlers observe successful lifecycle points. A post-success action failure is logged and does not falsely tell the client that an already committed database mutation rolled back.

Current event families include:

```text
items.query
items.read
items.create
items.update
items.delete

files.read
files.create
files.update
files.delete

users.create
users.update
users.delete
users.password.update

roles.create
roles.update
roles.delete

permissions.create
permissions.update
permissions.delete

schema.collection.create
schema.collection.update
schema.collection.delete
schema.field.create
schema.field.update
schema.field.delete
schema.relation.create
schema.relation.delete
schema.changed

auth.login.success
auth.login.failed
auth.refresh.success
auth.logout

mail.send
mail.sent
mail.failed

request.received
request.completed
request.failed
```

Auth/user event payloads are redacted and must not expose plaintext passwords, password hashes, bearer/refresh tokens or provider secrets.

Request lifecycle payloads are metadata-only; authorization headers, cookies and ordinary request bodies are not generic request-event payloads.

## Schema lifecycle boundary

Schema events are emitted after successful schema API mutation paths. O2O/M2M physical variants normalize to the stable public relation events:

```text
schema.relation.create
schema.relation.delete
```

Physical field alteration normalizes to:

```text
schema.field.update
```

Every successful specific schema event also produces `schema.changed`, including the schema version when the operation result exposes it.

Direct imports of low-level DDL helpers outside the supported API/service/extension runtime are not themselves a public extension-event contract.

## Application lifecycle

Supported init events:

```text
app.beforeStart
app.afterStart
app.beforeStop
app.afterStop
```

The server has a bounded graceful-shutdown path. Schedules stop before application shutdown hooks and receive only a bounded wait budget.

## Scheduled extension work

The scheduler is implemented without a cron package. It supports bounded five-field cron syntax:

```js
export default defineHook(({ schedule }) => {
  schedule('0 * * * *', async (context) => {
    // hourly
  }, {
    id: 'hourly-sync',
    accountability: 'system',
    mode: 'singleton',
  });
});
```

Rules:

- stable job id is required;
- `accountability: 'system'` must be requested explicitly; there is no implicit administrator/system context;
- overlap policy is `skip`;
- `per_process` runs independently in every API process;
- `singleton` uses a zero-wait MySQL advisory lock so only one replica owns a given run;
- a job receives services/database/logger/env/storage/getSchema and service-options helpers, not a fake HTTP request;
- jobs log start/success/failure/duration;
- shutdown stops new runs and waits only within the configured runtime budget.

## Trust boundary

Server extensions remain trusted JavaScript. YunCMS does not advertise them as an untrusted marketplace sandbox.

Even inside trusted extensions, supported service calls preserve ordinary authorization/accountability invariants unless the extension explicitly chooses system accountability in an API that permits it (for example the schedule API above).

## Deliberate non-goals

Not part of this roadmap:

- Studio interface/display/layout/module extension types;
- untrusted-code sandboxing;
- arbitrary middleware injection before core security middleware;
- durable distributed job queues;
- pretending post-commit external side effects are transactionally atomic with MySQL.

## Remaining work

Source implementation for the original event/scheduling roadmap is complete. Execute the runtime, scheduler singleton and redaction checks listed in `todo.md` before treating this exact source state as deployment-verified.
