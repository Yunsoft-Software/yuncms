# Testing YunCMS

YunCMS uses a staged test workflow so normal coding stays fast while release checks remain broad.

## Requirements

- Node.js 24 LTS.
- npm 11+.
- Installed workspace dependencies.
- No GitHub Actions are required or expected.

## Fast feedback — use after normal changes

```bash
npm run test:fast
```

This runs the security- and behavior-critical subset across core, API, CLI, extension SDK and Studio utility code. The runner captures normal test output and prints one short pass line. If the suite fails, it automatically reruns the failing stage with the detailed Node test reporter.

Use this as the default Codex loop. Do not run provider/browser integration after every source edit.

## Complete source suite

```bash
npm test
```

This discovers every `*.test.js` below:

- `packages/core/test`
- `packages/api/test`
- `packages/cli/test`
- `packages/extensions-sdk/test`
- `apps/studio/test`

It does not require external network, SMTP, S3 or a real MySQL server.

## Release source gate

```bash
npm run test:release
```

This performs:

1. complete source test suite;
2. Studio production build;
3. `npm pack --dry-run --json` contract checks for all public packages;
4. optional real MySQL/API integration when explicitly enabled.

The release runner still keeps successful output compact.

## Real MySQL/API integration

The integration test is intentionally opt-in because it creates and destroys temporary schema/data. Never point it at a production database.

Required safety conditions:

- database name must contain `test`, `ci` or `dev`;
- `YUNCMS_TEST_MYSQL=1`;
- `YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1`.

Example:

```bash
DB_HOST=127.0.0.1 \
DB_PORT=3306 \
DB_DATABASE=yuncms_test \
DB_USER=yuncms_test \
DB_PASSWORD='...' \
YUNCMS_TEST_MYSQL=1 \
YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 \
npm run test:release
```

The integration flow covers one real cross-feature path through:

- bootstrap/migrations and default public role;
- administrator login and refresh-token rotation;
- dynamic collections and fields;
- M2O and M2M relations;
- default-hidden M2M junction metadata plus visibility toggle;
- generic content CRUD, filter, sort, count and relation expansion;
- anonymous/public role fail-closed behavior;
- explicit public read permission with field and row restrictions;
- API tokens;
- local file upload/list/download/metadata update/delete;
- malformed JSON and request-id response contract;
- destructive relation/schema cleanup.

## Checks intentionally kept outside the routine source suite

Some claims depend on real infrastructure and cannot be proven by mocks:

- exact production MySQL version/permissions/network latency and backup/restore;
- the real S3-compatible provider and credential chain;
- actual SMTP delivery/recovery;
- full browser interaction/accessibility for built Studio;
- TLS/HSTS/reverse-proxy configuration;
- multi-instance/shared rate-limit behavior.

These remain explicit `todo.md` release/deployment checks rather than making everyday Codex runs expensive or flaky.

## Test-writing rules

- Prefer Node's built-in test runner.
- Add new critical regression files to `FAST_TESTS` in `scripts/verify.mjs` when they protect auth, permissions, schema integrity, production configuration or HTTP contracts.
- The complete source suite discovers test files automatically; no second list is needed.
- A test failure should name the capability that broke, not an implementation detail only.
- Never reduce assertions or skip a failing security test just to make the suite green.
