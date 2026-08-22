# Shared State — Implemented Source Boundary

Target baseline: `22-08-2026`.

Completed roadmap phases were removed from this file. There is currently **no pending shared-state source task required by the original Redis/cache roadmap**; real multi-process verification remains in `todo.md`.

## Implemented

YunCMS keeps Redis optional for simple single-process installs and supports a shared Redis mode when operators need multi-instance coordination.

Current source behavior:

- memory cache remains the default;
- Redis URLs support `redis://` and TLS `rediss://`;
- Redis credentials are parsed without being logged as operational output;
- keys use a configurable deployment prefix;
- permission caching uses the existing async cache contract;
- permission cache failure falls back to MySQL authorization rather than granting access;
- permission invalidation uses a Redis generation counter instead of wildcard `KEYS` scans;
- malformed/missing Redis permission cache entries are treated as cache misses;
- global API and auth rate limits may use one Redis-backed fixed-window budget;
- the Redis rate-limit increment/expiry operation is atomic through one Lua script;
- rate-limit failure supports `best-effort` local fallback or `required` fail-closed behavior;
- `/ready` checks Redis when shared state is configured as required;
- rate-limit identity material is SHA-256 hashed before becoming a Redis key;
- schema correctness remains MySQL-authoritative: each local `SchemaCache` periodically compares the authoritative MySQL schema version, so a replica does not require a restart to observe schema changes.

Example multi-instance configuration:

```env
CACHE_STORE=redis
API_RATE_LIMIT_STORE=redis
AUTH_RATE_LIMIT_STORE=redis
REDIS_URL=rediss://user:password@redis.example.com:6379/0
REDIS_PREFIX=yuncms:production:
REDIS_REQUIRED=true
RATE_LIMIT_FAILURE_MODE=required
```

Single-process installations may continue using:

```env
CACHE_STORE=memory
API_RATE_LIMIT_STORE=memory
AUTH_RATE_LIMIT_STORE=memory
```

## Correctness model

Redis is operational/shared state, not the application database and not an authorization source of truth.

```text
permission cache miss/error -> MySQL permission rows
schema cache refresh       -> MySQL schema version + metadata
Redis rate-limit error     -> configured local fallback or fail-closed policy
```

Permission changes increment the shared generation. Old generation keys expire naturally and stop being read without requiring key enumeration.

Schema invalidation does not rely solely on transient Redis pub/sub. The authoritative MySQL schema version is the recovery/correctness path.

## Deliberate non-goals

The following are not active roadmap tasks without evidence that they are needed:

- generic REST response/data caching;
- Redis as the primary database;
- moving authoritative sessions out of MySQL solely because Redis exists;
- a durable job queue;
- Redis pub/sub as a correctness requirement;
- arbitrary distributed locks for application code.

Extension singleton schedules use the existing MySQL advisory-lock primitive because it gives a simple authoritative cross-process execution guard without introducing another coordination dependency.

## Remaining work

Source implementation for this roadmap is complete. Before calling multi-instance behavior production-verified, execute the two-process MySQL + Redis failure/invalidation/rate-budget matrix listed in `todo.md`.
