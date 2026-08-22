# Directus-Parity Roadmap — Focused YunCMS Gaps

Status: roadmap index for the `22-08-2026` baseline. The linked documents describe planned work; they are not implementation claims.

## Why these four areas

YunCMS is intentionally not trying to reproduce the whole Directus product. The current core already covers the high-value foundation: dynamic MySQL schema, REST items, RBAC, Files, local authentication, React Studio and trusted server extensions.

The largest remaining gaps inside that chosen core are:

1. relation/query engine depth;
2. Redis/shared state for multi-instance deployments;
3. server extension event surface;
4. external authentication providers.

These are prioritized because they improve real application compatibility and production scalability without pulling YunCMS into GraphQL, visual flows, dashboards or other deliberately broader product areas.

## Roadmap documents

### 1. Query engine

[Query Engine Roadmap — Directus-Parity Relational Queries](roadmap-query-engine.md)

Covers:

- M2O/O2O/O2M/M2M traversal;
- bounded multi-depth `fields`;
- relational filters and to-one relational sort;
- `deep` nested query controls;
- search;
- aggregate/groupBy;
- selected safe functions;
- normalized query AST/planner architecture;
- RBAC at every relation boundary;
- N+1 prevention and cost limits.

### 2. Redis / shared state

[Shared State Roadmap — Redis, Cache and Multi-Instance Coordination](roadmap-shared-state.md)

Covers:

- Redis cache adapter;
- permission-cache invalidation across replicas;
- schema invalidation/version coordination;
- shared global/auth rate limiting;
- namespace/generation strategy;
- failure/degraded modes;
- optional later response/data caching;
- observability and multi-process tests.

### 3. Extension event surface

[Extension Event Surface Roadmap — Hooks, Lifecycle and Scheduled Work](roadmap-extension-events.md)

Covers:

- formal filter/action/init contracts;
- query/read hooks;
- Files lifecycle;
- auth/users/roles/permissions/schema/mail events;
- request/application lifecycle;
- deterministic hook ordering;
- transaction/commit semantics;
- recursion/reentrancy rules;
- scheduled jobs and multi-instance singleton concerns.

### 4. Authentication providers

[Authentication Provider Roadmap — OIDC, OAuth2, LDAP and SAML](roadmap-auth-providers.md)

Covers:

- common provider/identity architecture;
- safe account linking and JIT provisioning;
- OIDC first;
- generic OAuth2 fallback;
- LDAP/Active Directory;
- SAML;
- browser auth transaction/replay protection;
- multi-instance callback state;
- convergence to existing YunCMS users/sessions/RBAC.

## Recommended implementation order

The four tracks can partly progress independently, but the safest dependency order is:

```text
Query planner foundation
        |
        +--> Query/read extension hooks

Redis/shared-state foundation
        |
        +--> multi-instance scheduler singleton behavior
        +--> multi-instance external-auth transaction/replay state

External auth provider foundation
        |
        +--> OIDC
        +--> OAuth2
        +--> LDAP
        +--> SAML
```

Recommended main sequence:

1. query planner + deep relation foundation;
2. Redis/shared permission + rate-limit state;
3. formalize/expand extension events;
4. provider foundation + OIDC;
5. M2M/deep/aggregate query completion;
6. LDAP/SAML and scheduling after shared-state primitives are proven.

This order is not a requirement to finish an entire document before starting another. It exists to avoid building extension/query/provider features on temporary architecture that must immediately be replaced.

## Non-goals of this roadmap group

These documents do not propose:

- GraphQL;
- Directus visual Flows clone;
- Insights/dashboard clone;
- full Studio extension ecosystem;
- untrusted extension marketplace sandbox;
- realtime/WebSocket feature set;
- content versioning/editorial workflow;
- database engines other than MySQL;
- exact byte-for-byte Directus compatibility.

Those may be evaluated separately if YunCMS product scope changes.

## Cross-cutting invariants

Every implementation from these roadmaps must preserve:

- service-layer authorization;
- explicit accountability;
- Public deny-by-default behavior;
- field and row permission enforcement;
- no self-HTTP architecture;
- bound/parameterized SQL;
- bounded resource consumption;
- stable API keys;
- fail-closed unknown syntax/configuration;
- existing managed migration/update safety;
- source-complete is not deployment-verified until real MySQL/Redis/provider/browser tests pass.

## Completion standard

Do not mark a roadmap phase complete because code paths merely exist.

Each phase should have:

- source/unit coverage;
- real MySQL integration where relevant;
- multi-process/Redis integration where relevant;
- provider protocol integration where relevant;
- RBAC regression tests;
- failure/recovery tests;
- documentation examples verified against the running API;
- performance checks for query/shared-state changes.

The intent is to narrow the meaningful Directus gap while keeping YunCMS smaller, easier to reason about and explicitly MySQL/REST focused.
