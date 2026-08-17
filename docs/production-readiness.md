# YunCMS Production Readiness Audit

Audit target: branch `16-08-2026` after the collection-visibility, public-role and production-guard pass.

## Verdict

**Source status: production candidate for a single-instance/self-hosted V1 deployment.**

This pass did not identify a remaining source-level correctness or security blocker after the fixes listed below. That is not the same as claiming a deployment is already production-verified. The real Node 24 build/test run, MySQL integration flow and any provider-specific S3/SMTP/browser checks still have to pass in the target environment.

For a horizontally scaled deployment, additional operational work is still expected: authentication rate limits are process-local, local filesystem storage is not shared, and every instance has its own in-memory caches. Those are documented scale constraints rather than hidden single-instance failures.

## Blockers / production hazards found and fixed in this pass

### 1. Public role existed as a concept but was not guaranteed to exist

Previously the schema and RBAC engine supported one protected public role, and anonymous requests could resolve it, but bootstrap did not guarantee an actual public-role row.

Fix:

- migration `0005-default-public-role` creates one public role when none exists;
- existing databases now fail the migration compatibility gate until bootstrap applies `0005`;
- bootstrap also calls the idempotent `ensurePublicRole()` helper as a defensive invariant check;
- the public role receives **zero collection permissions by default**.

Result: public CMS data is opt-in and fail-closed. Administrators may explicitly grant `Read`, `Create`, `Update` or `Delete` to the Public role, including field allowlists, row filters and write validation. A public form can therefore receive `Create` only, while a public article collection can receive filtered `Read` only.

### 2. Collection visibility was implemented in metadata but not operable from Studio

The backend already supported `yuncms_collections.hidden`, Content navigation already ignored hidden collections, and M2M junction collections were already created hidden by default.

Fix:

- added Settings → Content Visibility;
- any non-system collection can be shown/hidden without changing its schema or records;
- M2M junctions are identified clearly and remain hidden by default;
- collection metadata boolean inputs now require real booleans instead of accepting ambiguous truthy strings.

### 3. Request identity was assigned after JSON parsing

Malformed JSON could fail before a request id had been attached to the request.

Fix:

- request identity now runs before `express.json()`;
- caller-provided request ids are allowlisted to safe characters and 64 characters maximum;
- invalid/oversized ids are replaced by a generated UUID;
- malformed JSON is normalized to `INVALID_PAYLOAD` / HTTP 400 instead of falling through as an internal error.

### 4. Authentication rate-limit bucket cap was not actually hard-bounded

The limiter attempted to prune when the bucket map reached its cap, but if all buckets were still active a stream of new client keys could continue growing the map.

Fix:

- expired buckets are removed first;
- when still at capacity, the oldest bucket is evicted before a new client bucket is created;
- invalid `maxBuckets` configuration is rejected;
- regression coverage proves bounded behavior.

### 5. Reverse-proxy client IP behavior was documented but not configurable

Authentication sessions and process-local rate limits depend on `req.ip`. Express does not trust proxy headers by default.

Fix:

- `TRUST_PROXY_HOPS` is explicit, bounded `0..10` configuration;
- default remains `0` (do not trust forwarded addresses);
- deployments behind a known proxy chain can set the exact hop count;
- the Express setting is covered by production-config tests.

## Area-by-area review

### Runtime and configuration

- Node.js 24 LTS is the required runtime.
- Express disables `x-powered-by`.
- startup checks required migrations and does not silently mutate an old DB;
- schema/bootstrap mutations use advisory locking;
- configuration parsing rejects invalid integer/boolean ranges;
- JSON request bodies are bounded to 1 MB; file uploads have a separate configurable byte limit;
- SIGINT/SIGTERM perform HTTP drain + DB pool close with a bounded force-exit fallback.

**Environment gate:** run the release command on the actual Node 24 environment and verify graceful shutdown behind the real process manager/reverse proxy.

### MySQL / dynamic schema

- only `mysql2/promise` is used;
- multiple statements are disabled;
- ordinary data values use bound placeholders;
- dynamic identifiers are validated and quoted;
- schema mutations are serialized;
- destructive collection/field/M2M operations require explicit destructive intent;
- metadata/physical-schema compensation paths exist for partial failures;
- schema versioning and migration compatibility are checked before listen.

**Environment gate:** real MySQL DDL/concurrency/deadlock/rollback behavior must pass against the exact production-compatible server/version.

### Authentication / sessions / API tokens

- passwords use the existing scrypt hashing path;
- opaque access/refresh/API/action tokens are stored hashed;
- access sessions are short-lived and refresh tokens rotate with an affected-row replay guard;
- disabled users cannot authenticate existing access/refresh tokens;
- auth responses are `no-store`;
- login/refresh/action endpoints are rate-limited;
- raw password-reset/verification tokens are not returned by the public request endpoints.

**Scale note:** auth rate-limit state is process-local. Use one instance for V1 or introduce a shared limiter/edge policy before calling a multi-instance deployment fully protected by one cluster-wide budget.

### Public access / RBAC

- exactly one protected public role is enforced by DB constraints + service rules;
- anonymous requests resolve through the same permission engine as authenticated users;
- no public permission exists automatically;
- missing public permission returns forbidden;
- public access can still use field allowlists, row filters and create/update validation;
- administrator/system bypass is explicit rather than inferred from missing accountability;
- role-less access fails closed.

Recommended public CMS pattern:

- public articles: `Read` + a row filter such as `status = published` + only public fields;
- public submission/contact form: `Create` only + strict writable fields + validation;
- never grant broad Public `Update/Delete` unless the product explicitly requires it.

### Generic content/query API

- query keys and operators are allowlisted;
- filter/sort fields are checked against schema and effective permissions;
- hidden-field inference is guarded;
- bulk update/delete require an explicit non-empty caller filter;
- prospective write validation evaluates the resulting row;
- relation expansion is bounded and reuses target collection RBAC.

### Files / storage

- physical storage keys are independent UUIDs rather than user filenames;
- local driver performs path containment checks;
- S3-compatible storage has a dedicated driver contract;
- upload metadata/storage failure compensation exists;
- reconciliation is explicit/dry-run-first and destructive orphan cleanup has an age guard;
- Studio preview requests remain authenticated and degrade to placeholders.

**Environment gates:** local storage permissions/persistence and any real S3-compatible provider still require real tests. For multiple API instances use shared storage/S3, not separate local disks.

### Audit / logging / observability

- structured JSON logging is used;
- audit/log payloads redact password/token/secret/authorization/api-key style keys;
- audit request ids and IPs are bounded to their DB column sizes;
- committed mutation audit failures are logged rather than pretending the business transaction rolled back;
- audit cleanup is bounded and explicit;
- `/health` and `/ready` provide process/database readiness signals.

Operationally monitor at least readiness failures, DB lock/deadlock errors, schema partial failures, storage cleanup/reconciliation errors, audit-write failures and auth rate-limit spikes.

### Extensions

- extension manifests/discovery paths are validated;
- extension endpoints run behind the normal authentication middleware;
- extension service context preserves accountability/permission cache;
- recursion-chain protection exists for hooks;
- extensions are intentionally **trusted server code** in V1.

Do not install untrusted third-party extensions and call that a sandboxed marketplace; sandboxing is not a V1 claim.

### Studio

- Studio uses the same-origin API by default and is built into the API package for one-port runtime;
- Content navigation now derives from explicit collection visibility;
- authenticated file previews use object URLs;
- Content has server-backed filter/sort/pagination;
- other administrative lists have bounded client-side pagination/search/sort;
- important destructive actions use explicit confirmation.

**Environment gate:** built browser smoke and formal accessibility review remain necessary.

## Known non-blocking V1 constraints

These are real constraints and should not be confused with bugs fixed in this pass:

- relation pickers currently load at most 200 target records;
- Files/Users/roles/schema administration lists are primarily client-filtered after list fetches; very large installations should move those list APIs to server pagination;
- process-local authentication rate limiting is not cluster-wide;
- automatic scheduled audit retention is not built in; cleanup is explicit;
- trusted extension code is not sandboxed;
- nested O2M/M2M expansion is outside V1;
- HSTS/TLS certificates/HTTP redirect remain reverse-proxy responsibilities;
- generic public content traffic should also have an appropriate edge/reverse-proxy rate policy for internet-facing high-traffic deployments.

## Automated test gates

Routine coding:

```bash
npm run test:fast
```

Complete source verification:

```bash
npm test
```

Release candidate:

```bash
npm run test:release
```

Real MySQL cross-feature release verification:

```bash
DB_DATABASE=yuncms_test \
YUNCMS_TEST_MYSQL=1 \
YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 \
npm run test:release
```

The MySQL integration DB must be disposable and its name must contain `test`, `ci` or `dev`.

## Release decision

A single-instance YunCMS V1 can be considered production-ready **after** all applicable release/environment gates pass on the target deployment. Source review alone is insufficient evidence for the MySQL server, S3 provider, SMTP provider, browser build/runtime, reverse proxy or backup/restore behavior.

At the end of this source pass, no additional source-level release blocker was identified. Remaining unchecked `todo.md` items are environment/provider/browser verification, not hidden implementation claims.
