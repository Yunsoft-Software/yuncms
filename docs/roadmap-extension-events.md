# Extension Event Surface Roadmap — Hooks, Lifecycle and Scheduled Work

Status: design/roadmap only. This document does not claim the events below are implemented.

Target branch baseline: `22-08-2026`.

## Purpose

YunCMS already has a small, Directus-inspired trusted server extension model:

- endpoint extensions receive an Express router plus context;
- hook extensions register `filter`, `action` and `init` handlers;
- extensions can call YunCMS services directly with request accountability;
- hook recursion is bounded with async chain tracking;
- current item mutation hooks cover create/update/delete;
- startup lifecycle events exist.

This is a strong foundation, but the event surface is too small for extensions to implement many real application behaviors without patching core.

The goal of this roadmap is to expand the server-side extension event surface while preserving service authorization, transaction clarity, deterministic behavior and a small SDK.

Reference behavior to study during implementation:

- Directus hooks: https://directus.com/docs/guides/extensions/api-extensions/hooks
- Directus custom extensions overview: https://directus.com/docs/guides/extensions/overview

This roadmap is about trusted server-side extension events. Studio interfaces/displays/layouts/modules/panels and marketplace sandboxing are separate product areas.

## Current baseline

Existing hook registration model:

```js
export default defineHook(({ filter, action, init }) => {
  filter('items.create', (payload, context) => payload);
  action('items.create', (meta, context) => {});
  init('app.beforeStart', (context) => {});
});
```

Current strengths:

- simple mental model;
- same-process service access;
- no self-HTTP requests;
- request accountability can be preserved;
- payload filters can reject/transform writes;
- successful actions happen after successful mutation;
- bulk create action timing is commit-aware;
- recursion depth protection exists.

Current gaps:

- no read/query hooks;
- no file lifecycle hook surface documented as extension API;
- no auth lifecycle hooks;
- no schema lifecycle hooks exposed as stable extension contract;
- no request/response events;
- no mail interception hooks;
- no scheduled-job registration API;
- no explicit transaction/commit-phase taxonomy across event families;
- no per-event contract/versioning policy.

## Design principles

### 1. Core authorization always remains authoritative

Extensions may transform a request/query/payload, but transformed data must go through normal schema/RBAC validation again.

Example:

```text
parse request
  -> extension filter transforms normalized input
  -> validate transformed result
  -> resolve RBAC
  -> execute service operation
```

Never assume the extension returned a safe query because extensions are "trusted". Trust means the package can run server-side code; core invariants should still be hard to bypass accidentally.

### 2. Event timing must be explicit

Every event must clearly state whether it runs:

- before validation;
- after normalization;
- before transaction;
- inside transaction;
- after DB mutation but before commit;
- after commit;
- after response.

A hook API that makes commit timing ambiguous will create data-consistency bugs.

### 3. Filter and action mean different things

- `filter`: synchronous/async interception that can transform or reject a value;
- `action`: observation/side effects after a defined successful lifecycle point;
- `init`: application lifecycle registration;
- future `schedule`: recurring background invocation.

Actions should not secretly change the result of the operation.

### 4. Event contracts are API contracts

Event name, payload shape and timing become extension compatibility surface.

Do not emit internal implementation objects casually and later rename them.

Each event family should document:

- payload;
- context;
- timing;
- mutability;
- transaction state;
- error behavior;
- bulk behavior.

## Proposed event taxonomy

Use names that are simple and stable. Exact final names may change before implementation, but categories should remain.

## Items — query/read

### `items.query`

Filter event over the normalized query representation.

Purpose:

- enforce product-specific default filters;
- adjust safe limits;
- add a product-specific query restriction;
- inject a computed selection request supported by the planner.

Required safety:

- handler receives normalized query AST, not raw SQL;
- returned query is fully revalidated;
- RBAC is applied after extension transformation;
- query cost limits are recalculated after transformation;
- extension cannot insert arbitrary SQL strings.

Conceptual:

```js
filter('items.query', (query, context) => {
  if (context.collection !== 'articles') return query;
  return {
    ...query,
    limit: Math.min(query.limit, 50)
  };
});
```

### `items.read`

Action event after a successful permission-filtered read.

Use cases:

- analytics/audit integration;
- cache warming;
- external observability.

Avoid passing huge full result arrays by default. Prefer metadata:

```js
{
  collection,
  query,
  keys,
  count,
  single
}
```

If response transformation is required later, introduce a separate explicit filter event rather than overloading an action observer.

## Items — mutations

Keep existing:

```text
items.create
items.update
items.delete
```

But formalize separate timing for filter/action.

Recommended lifecycle:

```text
normalize input
-> filter(items.create/update/delete)
-> revalidate transformed input
-> resolve permission + validation
-> execute mutation transaction
-> commit
-> action(items.create/update/delete)
```

For delete filters, payload should be safe normalized delete intent/filter metadata, not an arbitrary SQL predicate.

### Bulk semantics

Bulk operations must not emit an accidental unbounded action per item unless documented/configured.

Recommended action payload:

```js
{
  keys: [...],
  count: 250,
  bulk: true
}
```

A separate per-item mode should only be added if a concrete need exists and must have hard limits.

## Files

Expose stable extension events around `FilesService`:

```text
files.create
files.update
files.delete
files.read
```

Potential filters:

- metadata normalization before create/update;
- storage-target selection within configured storage registry;
- filename/title tagging;
- reject files by product-specific policy.

Security rules:

- MIME/signature/storage safety runs after any transformed metadata where relevant;
- extension cannot convert an unsafe storage key into a trusted one;
- permission checks still occur in `FilesService`;
- raw file contents should not be copied into generic event payloads unnecessarily.

If content inspection is needed, expose a deliberate bounded interface/stream rather than emitting full buffers to every hook.

## Users / roles / permissions

Stable action events:

```text
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
```

Some of these events already exist internally for audit purposes; that does not automatically make their current internal payload a public extension contract.

Before exposing them, define redaction rules.

Never include:

- plaintext passwords;
- password hashes;
- bearer tokens;
- refresh tokens;
- API-token secret values.

Permission/role extension filters must never weaken protected Administrator/Public invariants by bypassing service checks.

## Schema lifecycle

Useful action events:

```text
schema.collection.create
schema.collection.update
schema.collection.delete
schema.field.create
schema.field.update
schema.field.delete
schema.relation.create
schema.relation.delete
schema.changed
```

`schema.changed` can be the broad event for cache/index rebuilds, while specific events carry operation metadata.

Timing requirement:

- action only after the schema mutation/metadata lifecycle is considered successful;
- do not emit successful schema action if DDL compensation/recovery is still pending;
- include new schema version.

Potential filters before DDL should be added cautiously. Schema mutation invariants are harder to preserve than item payload transforms. Start with post-success actions; add pre-mutation filters only after explicit use cases exist.

## Authentication lifecycle

Useful events:

```text
auth.login.success
auth.login.failed
auth.refresh.success
auth.logout
auth.password_reset.requested
auth.password_reset.completed
auth.email_verification.completed
```

Use cases:

- security telemetry;
- external audit/SIEM;
- custom account policy;
- login notifications.

Failure-event privacy rules:

- do not expose whether an unknown email exists if the public endpoint intentionally hides that fact;
- avoid raw credentials;
- include bounded reason categories rather than sensitive internals;
- rate-limit/recursion behavior must prevent a failing security hook from creating a login amplification loop.

A future pre-auth filter may support product-specific deny rules, but it must not receive plaintext passwords unless there is an unavoidable and documented reason. Prefer identity/request metadata.

## Mail events

Potential hooks:

```text
mail.send
mail.sent
mail.failed
```

`mail.send` filter can allow:

- subject/body/template adjustment;
- additional safe headers;
- product-specific sender choice among configured senders.

Security:

- keep Nodemailer file/URL access disabled;
- do not allow arbitrary extension payload to re-enable unsafe transport features;
- redact credentials and one-time auth tokens from generic logs/actions;
- distinguish message content from SMTP transport secrets.

## HTTP request/response lifecycle

These are powerful and should be intentionally narrow.

Potential action events:

```text
request.received
request.completed
request.failed
```

Recommended payload is metadata only:

```js
{
  requestId,
  method,
  route,
  status,
  durationMs,
  accountability: { user, role, admin },
  ip
}
```

Do not emit raw authorization headers, cookies or request bodies by default.

Avoid a global mutable request filter in the first version; it becomes an alternate middleware system that can undermine route invariants.

## Application lifecycle

Keep existing:

```text
app.beforeStart
app.afterStart
```

Add when needed:

```text
app.beforeStop
app.afterStop
```

`beforeStop` should have a bounded shutdown budget. An extension must not be able to keep graceful shutdown alive forever.

## Scheduled jobs

Add a `schedule` registration primitive only after the event surface is stable.

Conceptual API:

```js
export default defineHook(({ schedule }) => {
  schedule('0 * * * *', async (context) => {
    // hourly work
  });
});
```

### Scheduling rules

- validate schedule at startup;
- invalid schedule fails extension startup;
- each job has stable extension/job identity;
- bound concurrent overlap;
- support `skip` as default when previous run is still active;
- log start/success/failure/duration;
- expose system accountability deliberately, not implicitly;
- job context gets services/logger/env/getSchema, but no fake HTTP request;
- shutdown stops new runs and waits only within graceful budget.

### Multi-instance problem

A local scheduler will run once per API replica.

Therefore scheduled jobs must explicitly define deployment semantics before production use:

1. `per_process` — every replica runs it;
2. `singleton` — exactly one active execution across deployment.

Do not pretend singleton scheduling exists until a shared coordination mechanism (Redis/MySQL lock) is implemented and tested.

For YunCMS core maintenance-style singleton jobs, a MySQL advisory lock may be sufficient. General recurring jobs may later use the shared-state layer.

## Event context contract

Every hook should receive a consistent base context where applicable:

```js
{
  services,
  database,
  logger,
  env,
  emitter,
  getSchema,
  accountability,
  requestId,
  collection,
  operation,
  chain
}
```

Do not create separate incompatible context shapes for every event without need.

### Service options helper

For request-originating hooks, provide a documented helper to instantiate services preserving:

- accountability;
- request id;
- schema snapshot;
- permission cache;
- hook chain;
- transaction/connection only when safe and explicitly supported.

Do not encourage self-HTTP.

## Transaction semantics

This must be documented per event.

Recommended default:

- `filter` mutation hooks run before the mutation transaction unless they need transaction context;
- core validation follows filter transformation;
- mutation executes transactionally where existing service semantics allow;
- `action` fires after successful commit;
- external network side effects belong in post-commit action, not inside the DB transaction.

Why:

If an extension sends an external webhook inside a DB transaction and the DB later rolls back, the external system has observed an event that never committed.

If a future use case requires an in-transaction hook, give it a different explicit API/event phase rather than changing action semantics silently.

## Error semantics

### Filter error

- abort operation;
- normalize to extension-safe error response;
- preserve extension/event identity in structured logs;
- do not expose internal stack in production.

### Action error

Once the DB transaction has committed, action failure cannot roll back reality.

Default:

- log action failure;
- mark extension action failed in observability;
- do not tell client the already-committed mutation failed unless the API explicitly defines synchronous side-effect semantics.

This mirrors the existing audit principle: post-commit side-effect failure should not turn a committed write into a misleading client failure.

For critical external delivery, a future durable outbox/queue is more correct than pretending post-commit hooks are transactional.

## Hook ordering

Multiple extensions may register the same filter.

Define deterministic order.

Recommended inputs:

- extension discovery order must not depend on filesystem nondeterminism;
- optional integer priority in manifest/definition;
- stable tie-breaker by extension id + registration index.

Example:

```text
priority 100 -> first
priority 0   -> default
priority -100 -> later
```

Document whether high or low values run first and never change it casually.

## Recursion / reentrancy

Keep AsyncLocalStorage chain tracking.

Expand metadata:

```js
{
  chainId,
  depth,
  stack: [event...],
  originExtension,
  originEvent
}
```

Rules:

- global max depth;
- optional same-event repeat limit;
- nested service calls allowed;
- unrelated concurrent requests never share chain state;
- scheduled jobs start a new chain;
- actions triggered by action-side service calls create nested chain entries.

Do not prohibit all recursion; legitimate workflows may update related records. Bound it instead.

## Extension isolation and trust

V1 remains trusted server-side JavaScript.

Therefore:

- extension code can still access process capabilities available to it;
- do not advertise untrusted marketplace safety;
- package discovery remains fail-fast;
- malformed event registration fails startup;
- future sandbox/capability isolation is a separate roadmap.

Still, core services should preserve authorization invariants even for trusted extension authors so accidental misuse is harder.

## Implementation phases

### Phase E1 — Formalize current contracts

- document existing item mutation filter/action timing;
- introduce event definition registry/schema;
- deterministic handler ordering;
- stable base context;
- tests for bulk/commit/error/recursion semantics.

Exit criterion: existing extensions behave the same but event contracts are explicit/tested.

### Phase E2 — Query/read and Files

- `items.query` normalized-AST filter;
- revalidation/cost/RBAC after query transform;
- `items.read` action metadata;
- Files create/update/delete/read action surface;
- safe file metadata filters where justified.

Exit criterion: product-specific read restrictions and file workflows no longer require core patches.

### Phase E3 — Auth/user/role/permission/schema/mail lifecycle

- expose redacted stable events;
- schema post-success events;
- auth success/failure telemetry events;
- mail interception/action events;
- documentation and examples.

Exit criterion: security/audit/integration extensions can observe core lifecycle without internal imports.

### Phase E4 — Request/application lifecycle

- request completion/failure metadata;
- graceful shutdown init events;
- bounded handler execution where needed.

Exit criterion: extensions can integrate monitoring/lifecycle cleanup safely.

### Phase E5 — Scheduling

- schedule registration API;
- validation;
- overlap policy;
- shutdown behavior;
- explicit single-process vs singleton deployment semantics;
- shared coordination integration when available.

Exit criterion: recurring extension work is supported without cron scripts that bypass YunCMS service context.

## Required tests

At minimum:

- filter transformation followed by full schema/RBAC revalidation;
- filter cannot widen field allowlist accidentally;
- query filter cannot exceed query cost limits;
- action fires only after successful commit;
- failed mutation emits no success action;
- action failure after commit does not misreport DB rollback;
- deterministic ordering across multiple extensions;
- recursion limit with nested service calls;
- concurrent requests keep separate chains;
- bulk action payload is bounded;
- password/token material absent from auth/user events;
- request events redact auth headers/cookies;
- schema event fires only after successful DDL lifecycle;
- invalid schedule fails startup;
- overlapping schedule behavior;
- multi-replica singleton tests when shared coordination is implemented.

## Deliberate non-goals

For this roadmap:

- no Studio interface/display/layout/module extension types;
- no untrusted marketplace sandbox;
- no arbitrary Express middleware injection before core security middleware;
- no durable distributed job queue;
- no promise that action hooks are transactionally atomic with external side effects;
- no self-HTTP architecture.

## Definition of done

This roadmap is complete when trusted extensions can react to and safely customize the important YunCMS server lifecycle — queries, reads, item/file mutations, auth, schema, mail, request/application lifecycle and scheduled work — through stable documented contracts without bypassing service-layer RBAC or depending on internal core implementation details.
