# Shared State Roadmap — Redis, Cache and Multi-Instance Coordination

Status: design/roadmap only. This document does not claim Redis/shared-state support is implemented.

Target branch baseline: `22-08-2026`.

## Purpose

YunCMS currently has a bounded asynchronous memory-cache abstraction used by permission resolution, while auth/rate-limit state is process-local. That is acceptable for one API process, but it is not enough for horizontally scaled production deployments.

This roadmap defines how YunCMS should add shared state without making Redis a mandatory dependency for simple single-process installs.

Reference behavior worth studying:

- Directus cache configuration and Redis deployments;
- Directus shared Redis use for cache/invalidation/rate limiting;
- Directus cache clear/namespace operational patterns.

The goal is not "put everything in Redis". The goal is to identify which state must be shared, which state is only an optimization, and how failures must behave.

## Current baseline

On `22-08-2026`:

- `MemoryCacheStore` is bounded by TTL and maximum entry count;
- permission decisions can use the configured cache abstraction;
- permission mutations clear the process-local permission cache;
- auth/global request limits are process-local;
- multi-process cache invalidation is not coordinated;
- there is no runtime Redis adapter;
- a second API process can hold different cached permission state from the first;
- process-local rate limits multiply with replica count.

The existing asynchronous `get/set/delete/clear` cache contract is a good seam, but shared-state needs more than replacing `Map` with Redis.

## State categories

YunCMS should explicitly separate five concerns.

### 1. Permission cache

This is an optimization, not the source of truth.

Source of truth remains MySQL permission rows and schema metadata.

Required behavior:

- cache hit may avoid repeated permission SQL;
- cache miss loads from MySQL;
- Redis outage must never grant access;
- malformed cache data must be ignored/reloaded, not trusted blindly;
- permission mutation must invalidate all replicas quickly.

### 2. Schema cache / schema version coordination

Each process may keep an in-memory schema snapshot for speed, but replicas need a reliable way to notice schema changes.

Recommended model:

- MySQL schema version remains authoritative;
- local schema snapshot keeps its version;
- schema mutation publishes an invalidation event when shared state is enabled;
- consumers discard local schema caches;
- a missed event is still recoverable because requests/startup periodically compare authoritative schema version where required.

Redis pub/sub may speed invalidation, but correctness must not depend solely on delivery of a transient pub/sub message.

### 3. Rate-limit counters

Unlike permission cache, rate limits are security/abuse-control state.

With multiple replicas, a process-local limit of 100 requests effectively becomes roughly `100 x replicas`.

Target shared counters:

- global API rate limiting;
- login rate limiting;
- refresh rate limiting;
- password reset / verification action limiting;
- future extension/webhook limits where applicable.

Counters need atomic increment + TTL behavior.

### 4. Data/response cache

This is optional and should come after shared permission/rate-limit state.

A generic response cache has harder invalidation problems:

- item writes;
- relation writes;
- permission differences;
- Public vs authenticated users;
- schema changes;
- field allowlists;
- query parameter canonicalization;
- file metadata/content.

Do not add response caching merely because Redis exists.

If implemented, start with explicitly cacheable read paths and deterministic invalidation/version keys.

### 5. Coordination/invalidation bus

Useful events include:

```text
permissions.changed
roles.changed
users.role_changed
schema.changed
studio_settings.changed
files.metadata_changed
cache.flush
```

Do not treat this bus as a durable event queue. It exists to accelerate invalidation/coordination. Authoritative state remains in MySQL/storage.

## Deployment modes

### Mode A — Single process, memory only

Default development/simple deployment mode.

```text
CACHE_STORE=memory
```

Characteristics:

- no Redis requirement;
- existing bounded local permission cache;
- local rate limiter;
- clear documentation that limits/cache are per-process.

### Mode B — Shared Redis

Recommended for more than one API process/container.

Conceptual configuration:

```text
CACHE_STORE=redis
REDIS_URL=redis://127.0.0.1:6379
REDIS_PREFIX=yuncms:project-name:
```

Additional settings may include:

```text
REDIS_CONNECT_TIMEOUT_MS=5000
REDIS_COMMAND_TIMEOUT_MS=3000
REDIS_REQUIRED=false
PERMISSION_CACHE_TTL_MS=30000
RATE_LIMIT_STORE=redis
```

Exact names should be finalized when implementation starts.

## Redis key design

Every key must be namespaced.

Recommended base:

```text
yuncms:<deployment-namespace>:<purpose>:...
```

Examples:

```text
yuncms:prod-a:permission:<role>:<collection>:<action>
yuncms:prod-a:rate:login:<ip-or-identity>:<window>
yuncms:prod-a:schema:version
yuncms:prod-a:invalidate:sequence
```

Never rely on one Redis database number as sufficient namespacing. Shared Redis services often host multiple applications.

Namespace should be configurable and stable across replicas of one deployment.

## Permission-cache design

### Cache value

Store only the normalized permission resolution result required by the service.

Do not cache:

- plaintext tokens;
- password material;
- arbitrary request objects;
- secrets from environment;
- full user records when unnecessary.

Include a format/version marker so future code can reject incompatible cache payloads.

Conceptual value:

```json
{
  "v": 1,
  "fullAccess": false,
  "role": "...",
  "collection": "articles",
  "action": "read",
  "fields": ["id", "title"],
  "filter": {"status":{"_eq":"published"}},
  "validation": null
}
```

### Invalidation

Naive `KEYS` scans must not be required in production.

Two acceptable patterns:

1. versioned namespace generation;
2. explicit known-key deletion plus invalidation generation/event.

A simple robust design is a permission generation counter:

```text
permission-generation = 42
key = permission:42:<role>:<collection>:<action>
```

On permission/role-sensitive mutation, atomically increment generation. Old keys naturally expire and are no longer read. This avoids cross-node key enumeration.

If generation reads become hot, keep a very short local copy plus pub/sub invalidation; correctness still falls back to Redis/MySQL version state.

## Schema invalidation

Schema state is more sensitive than ordinary cached data because stale schema can produce incorrect field validation/query behavior.

Recommended rules:

- MySQL `schema_version` remains source of truth;
- after committed schema mutation, publish invalidation only after version increment succeeds;
- each process marks its local `SchemaCache` stale;
- request/service paths that need schema call the normal cache loader, which reloads from MySQL;
- on pub/sub disconnect/reconnect, force local schema invalidation;
- startup always loads authoritative state rather than trusting Redis only.

## Shared rate limiter

Use an atomic Redis operation for fixed-window counters.

Desired semantics:

1. derive normalized bucket key;
2. increment atomically;
3. set TTL when first created;
4. read remaining TTL for `Retry-After`;
5. reject over limit.

A Lua script or transaction-safe primitive can guarantee increment/expiry behavior without races.

Do not implement shared limiting as separate `GET` then `SET` calls.

### Identity keys

Depending on route:

- unauthenticated login: trusted client IP + normalized account identifier where useful;
- authenticated route: user/API token identity plus IP when appropriate;
- password reset: IP and normalized target identifier, without leaking account existence.

Avoid putting raw email addresses or tokens into Redis keys. Hash sensitive identifiers before key construction.

## Failure policy

Redis failures must be classified by feature.

### Permission cache failure

Safe fallback:

- log structured degraded-state warning;
- query MySQL directly;
- continue authorization normally.

Never convert "Redis unavailable" into full access.

### Schema invalidation failure

Safe fallback:

- local cache invalidation after local mutation;
- version checks against MySQL;
- mark shared invalidation unavailable;
- if strict multi-instance mode is configured, readiness may fail until coordination returns.

### Rate-limit Redis failure

Two deployment policies should be supported:

#### Best-effort mode

Fallback to local limiter and emit a prominent degraded-security warning.

Good for small installs where availability is preferred.

#### Required mode

When operator config says shared limiter is mandatory, `/ready` should become not-ready and protected auth endpoints may fail closed rather than silently losing the intended global limit.

Do not hide which mode is active.

## Readiness and observability

Expose enough state to operate the system without exposing secrets.

Useful readiness/diagnostics:

- cache store type;
- Redis connected/disconnected;
- shared limiter active/degraded;
- invalidation subscriber active;
- last invalidation sequence/version seen;
- cache hit/miss counters;
- Redis command error count;
- local fallback count.

Do not return `REDIS_URL`, credentials or raw keys from public health endpoints.

Metrics/logs should distinguish:

```text
cache.permission.hit
cache.permission.miss
cache.permission.error
redis.connected
redis.disconnected
rate_limit.shared_fallback
schema.invalidation.received
schema.invalidation.error
```

## Security requirements

- support TLS Redis URLs where provider requires it;
- support password/ACL credentials through environment, never logs;
- redact Redis URLs with credentials;
- use deployment namespace prefix;
- never deserialize executable content;
- JSON parse cache values defensively;
- cap cached object size where practical;
- set TTLs on ephemeral keys;
- no unbounded key creation from arbitrary raw user strings;
- hash sensitive rate-limit identifiers;
- Redis is not an authorization source of truth.

## Response/data caching — later phase

If a Directus-like data cache is added, the cache key must include all semantics that affect response data:

- collection;
- normalized query AST;
- accountability/permission generation;
- schema generation/version;
- API representation version;
- locale or other response-affecting options.

Do not use raw URL order as the only cache key; equivalent queries with reordered parameters should canonicalize consistently.

### Invalidation options

Prefer generation/version keys over trying to enumerate all cached queries touched by a mutation.

Example:

```text
data-generation:<collection> = 17
```

Read cache key includes collection generation. Item mutation increments the relevant collection generation. Relation mutation may increment source and target generations.

This trades some stale unused keys until TTL expiry for reliable invalidation without wildcard key scans.

## Implementation phases

### Phase S1 — Redis adapter foundation

- define shared-store connection lifecycle;
- implement Redis cache adapter matching async cache contract;
- add namespace handling;
- add redacted config validation;
- add reconnect/error tests;
- keep `memory` default.

Exit criterion: permission cache can use Redis without changing `PermissionsService` semantics.

### Phase S2 — Permission invalidation across replicas

- generation/version strategy;
- mutation invalidation;
- pub/sub fast-path if chosen;
- reconnect invalidation;
- two-process integration test.

Exit criterion: permission removal on process A is reflected on process B without waiting for a long stale TTL.

### Phase S3 — Shared rate limiting

- Redis fixed-window store;
- atomic counter/expiry;
- global/auth/action limiter adapters;
- best-effort vs required failure policy;
- correct `429`/`Retry-After` behavior.

Exit criterion: two API processes share one effective request budget.

### Phase S4 — Schema/settings invalidation

- schema version notification;
- local schema cache invalidation across replicas;
- optional Studio settings invalidation where caching exists;
- reconnect safety.

Exit criterion: schema mutation does not require restarting other API replicas.

### Phase S5 — Optional response/data cache

Only after profiling proves it is useful.

- cacheable GET path definition;
- canonical query key;
- permission/schema/collection generations;
- mutation invalidation;
- cache-control interaction;
- size/TTL limits.

Exit criterion: measurable latency/DB reduction without stale permission/data leaks.

## Required integration tests

At minimum run two independent API processes against the same MySQL + Redis:

- permission grant on A becomes usable on B;
- permission removal on A is denied on B immediately/bounded by designed invalidation semantics;
- Public Files permission changes propagate;
- role changes invalidate affected decisions;
- schema field create/delete becomes visible to B;
- Redis restart during normal reads falls back safely;
- Redis restart never grants access;
- rate-limit requests split across A/B still hit one global limit;
- namespace isolation between two test deployments;
- reconnect does not revive stale schema/permission state;
- Redis auth/TLS configuration errors are redacted;
- no cache keys contain bearer tokens/passwords/raw sensitive identifiers.

## Operational guidance

Single-process installs should not need Redis.

Redis becomes strongly recommended when any of these are true:

- more than one API replica;
- process manager cluster mode;
- multiple containers sharing one DB;
- global auth/request rate limits are relied upon;
- frequent permission/schema changes must propagate immediately across nodes;
- future WebSocket/background-worker features require coordination.

Back up MySQL and object storage, not Redis, as the primary application state. Redis should remain reconstructable ephemeral/shared operational state.

## Deliberate non-goals

- Redis as primary database;
- storing sessions only in Redis when MySQL is currently authoritative;
- queue/job framework in this phase;
- distributed locks for arbitrary application code;
- response caching before permission/invalidation correctness;
- requiring Redis for local development or one-process deployments.

## Definition of done

This roadmap is complete when YunCMS can run multiple API replicas with coherent permission/schema behavior, one shared rate-limit budget, clear failure modes and observability, while preserving a simple memory-only single-process mode and never allowing cache/shared-state failure to bypass authorization.
