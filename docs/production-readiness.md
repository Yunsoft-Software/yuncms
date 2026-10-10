# Operator Verification and Production Readiness Guide

This guide describes YunCMS verification commands, test runner profiles, required environment flags, dedicated disposable database boundaries, and operational acceptance layers before deploying to production.

## Operational Safety Rules

> [!CAUTION]
> **Never run integration, migration, upgrade, or strict test suites against a production database.**
> Real integration and upgrade suites perform destructive actions: resetting schemas, truncating tables, executing DDL, and testing full project restores. All database names configured for testing must contain `test`, `ci`, or `dev`.

- **Explicit opt-in only:** Destructive test execution requires `YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1`.
- **Dedicated disposable fixtures:** Integration, schema migration, and managed-upgrade test suites must use distinct databases so that active test fixtures are not destroyed by parallel or sequential upgrade runs.
- **Fail-closed verification:** Tests and verification runners never enable flags automatically. Missing configuration fails immediately with explicit diagnostic errors.

---

## Verification Commands and Test Profiles

> [!NOTE]
> Verification commands (`npm run test:fast`, `npm test`, `npm run test:release`, `node scripts/verify.mjs`) are executed from a YunCMS source checkout. Packaged consumer application projects that install YunCMS as a dependency do not automatically inherit these repository npm scripts.

YunCMS provides four verification profiles configured via `scripts/verify.mjs`:

```bash
# 1. Routine regression (fast)
npm run test:fast

# 2. Complete repository source suite (full)
npm test

# 3. Release candidate verification
npm run test:release

# 4. Strict release verification gate
YUNCMS_TEST_STRICT=1 npm run test:release
# or directly:
node scripts/verify.mjs strict
```

### 1. Fast Regression Suite (`npm run test:fast`)

- **Scope:** Targeted unit and regression tests covering core service logic, API routing, CLI commands, extensions SDK, and Studio state.
- **Infrastructure required:** None. Runs purely in Node 24 LTS without external services.
- **Output:** Structured TAP summary displaying executed, passed, failed, skipped, todo, and cancelled counts.

### 2. Complete Source Suite (`npm test`)

- **Scope:** All unit test files across `packages/core`, `packages/api`, `packages/cli`, `packages/extensions-sdk`, and `apps/studio`.
- **Infrastructure required:** None. Executes all isolated tests and pure mocks across the repository.
- **Behavior:** Passes if all executed tests succeed; skips are permitted for optional infrastructure-dependent suites.

### 3. Release Candidate Suite (`npm run test:release`)

- **Scope:**
  1. Complete source suite.
  2. Studio production build (`npm run build:studio`).
  3. Package pack contract checks (`npm pack --dry-run` for all published workspaces).
  4. Real MySQL/API integration suite when `YUNCMS_TEST_MYSQL=1`.
- **Routine mode behavior:** If `YUNCMS_TEST_MYSQL=1` is not set, real database integration is reported as skipped while build and package checks proceed.

### 4. Strict Release Gate (`YUNCMS_TEST_STRICT=1`)

- **Scope:** Comprehensive, zero-skip release gate for production sign-off.
- **Docker candidate:** Build the candidate from the current source revision with `npm run docker:build`, then pass its local image tag through `YUNCMS_TEST_DOCKER_IMAGE`. The backup/restore fixture checks the image version and revision against this checkout before creating its disposable resources.
- **Pre-flight requirements:** Validates all required integration flags and database names before executing tests:
  - `YUNCMS_TEST_MYSQL=1`
  - `YUNCMS_TEST_REDIS=1`
  - `YUNCMS_TEST_MIGRATION=1`
  - `YUNCMS_TEST_UPGRADE=1`
  - `YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1`
  - `YUNCMS_TEST_DOCKER=1` (required when multi-user container integration tests are present)
  - Valid `YUNCMS_TEST_REDIS_URL` (`redis://` or `rediss://`)
  - Disposable `DB_DATABASE` (containing `test`, `ci`, or `dev`)
  - Disposable `YUNCMS_MIGRATION_TEST_DB_DATABASE` (containing `test`, `ci`, or `dev`)
  - Disposable `YUNCMS_UPGRADE_TEST_DB_DATABASE` (containing `test`, `ci`, or `dev`)
  - `YUNCMS_MIGRATION_TEST_DB_DATABASE` distinct from `DB_DATABASE`
  - `YUNCMS_UPGRADE_TEST_DB_DATABASE` distinct from `DB_DATABASE` and migration DB
- **Strict result evaluation:** Strict mode fails immediately if:
  - Any required flag or disposable database name is missing.
  - Test summary output is missing or could not be captured.
  - Executed test count is zero.
  - Any test fails, is skipped, marked todo, or cancelled.

---

## Environment Flags and Configuration Reference

| Variable | Strict Gate | Expected Value | Purpose |
| --- | --- | --- | --- |
| `YUNCMS_TEST_MYSQL` | Required (`1`) | `1` | Enables real MySQL integration tests in `test/integration/`. |
| `YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE` | Required (`1`) | `1` | Confirms explicit permission to run destructive DDL/DML on test databases. |
| `DB_DATABASE` | Required | e.g. `yuncms_test` | Primary disposable MySQL database. Must contain `test`, `ci`, or `dev`. |
| `DB_HOST` | Optional | e.g. `127.0.0.1` | MySQL server host (defaults to `127.0.0.1`). |
| `DB_PORT` | Optional | `3306` | MySQL server port (defaults to `3306`). |
| `DB_USER` | Optional | e.g. `root` | MySQL user. |
| `DB_PASSWORD` | Optional | string | MySQL password. |
| `YUNCMS_TEST_REDIS` | Required (`1`) | `1` | Enables Redis multi-process integration tests. |
| `YUNCMS_TEST_REDIS_URL` | Required | e.g. `redis://127.0.0.1:6379/1` | Redis connection URL for shared cache and rate-limit testing. |
| `YUNCMS_TEST_MIGRATION` | Required (`1`) | `1` | Enables schema migration integration suite. |
| `YUNCMS_MIGRATION_TEST_DB_DATABASE` | Required | e.g. `yuncms_mig_test` | Dedicated disposable database for schema migration runs. |
| `YUNCMS_TEST_UPGRADE` | Required (`1`) | `1` | Enables managed backup/restore and upgrade integration suite. |
| `YUNCMS_UPGRADE_TEST_DB_DATABASE` | Required | e.g. `yuncms_upg_test` | Dedicated disposable database for backup and restore checks. |
| `YUNCMS_TEST_DOCKER` | Required (`1`) | `1` | Enables containerized multi-user isolation integration tests. |
| `YUNCMS_TEST_DOCKER_IMAGE` | Required when Docker tests are enabled | e.g. `yunsoftofficial/yuncms:0.1.27` | Prebuilt local candidate image for physical backup/restore; version and revision must match the source checkout. |
| `YUNCMS_TEST_STRICT` | Optional (`1`) | `1` | Activates strict verification enforcement on release test runs. |

### Example Strict Verification Invocation

```bash
DB_DATABASE=yuncms_integration_test \
YUNCMS_MIGRATION_TEST_DB_DATABASE=yuncms_migration_test \
YUNCMS_UPGRADE_TEST_DB_DATABASE=yuncms_upgrade_test \
YUNCMS_TEST_MYSQL=1 \
YUNCMS_TEST_REDIS=1 \
YUNCMS_TEST_REDIS_URL=redis://127.0.0.1:6379/2 \
YUNCMS_TEST_MIGRATION=1 \
YUNCMS_TEST_UPGRADE=1 \
YUNCMS_TEST_DOCKER=1 \
YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 \
YUNCMS_TEST_STRICT=1 \
npm run test:release
```

---

## Acceptance Layers and Validation Boundaries

Different verification stages provide distinct guarantees. Do not conflate runner test execution with extra manual browser, consumer, or container acceptance.

### 1. Source Acceptance (Automated by runner)
- **What it verifies:** Pure JavaScript/ESM unit logic, query parsing, filter compilation, RBAC decision trees, schema key normalization, and CLI argument validation.
- **Boundary:** Uses in-memory state and mocked database interfaces. Does not verify physical MySQL behaviors, transaction isolation, network latency, or storage drivers.

### 2. MySQL Acceptance (Automated by runner when opted in)
- **What it verifies:** Real MySQL 8.x/InnoDB interactions, dynamic DDL execution, index creation, foreign key cascading, `DATETIME`/`TIMESTAMP` handling with timezone `Z`, connection pool error fail-closed behavior, and transaction rollback isolation.
- **Boundary:** Requires a real MySQL instance with InnoDB support. Verifies database driver contracts directly against `mysql2/promise`.

### 3. Redis Acceptance (Automated by runner when opted in)
- **What it verifies:** Distributed cache invalidation across separate worker processes, and shared rate-limit buckets.
- **Boundary:** Requires a running standalone Redis instance. Verifies that multiprocess instances correctly synchronize shared state.

### 4. Migration & Upgrade Acceptance (Automated by runner when opted in)
- **What it verifies:** Sequential execution of database migrations from initial schemas, backward compatibility, project snapshot manifests, `mysqldump` backup generation, and full project restore integrity.
- **Boundary:** Exercises CLI backup/restore processes and native MySQL dump binaries against disposable databases.

### 5. Build & Package Metadata Acceptance (Automated by runner)
- **What it verifies:** Vite frontend bundle generation for Studio, package dependency isolation, license file inclusion, and npm pack metadata checks (`npm pack --dry-run`).
- **Boundary:** Confirms that release package manifests contain required runtime assets. `npm pack --dry-run` checks metadata only; it does not test clean external installation or runtime dependency resolution.

### 6. Clean Consumer Acceptance (Manual external verification)
- **What it verifies:** Installing packed `.tgz` tarballs in a completely clean external Node project, verifying published SDK exports (`defineEndpoint`, `defineHook`), CLI binaries, and runtime startup without workspace symlinks.
- **Boundary:** Performed outside the repository monorepo using clean consumer fixtures.

### 7. Browser Acceptance (Manual external verification)
- **What it verifies:** Studio administration UI in real browsers: responsive drawer navigation, dark/light theme persistence, authenticated file previews, content editors, and permission matrix tables.
- **Boundary:** Requires manual or dedicated browser smoke testing on supported desktop and mobile viewports.

### 8. Container Acceptance (Manual external verification)
- **What it verifies:** Docker image build (`node scripts/docker-image.mjs --load`), non-root container execution, `/health` and `/ready` HTTP probe responses, environment variable injection, and clean SIGTERM graceful shutdown.
- **Boundary:** Confirms that containerized deployments start and shut down cleanly without root privileges.
