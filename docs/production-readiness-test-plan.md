# YunCMS Production Readiness & Test Plan

This pass continues directly on branch `16-08-2026`. It keeps the current product scope and focuses on collection visibility, safe public access, production-readiness checks and a compact but comprehensive test workflow that Codex can run without noisy output or GitHub Actions.

## Constraints

- No GitHub Actions.
- Small focused commits.
- No new product module and no GraphQL.
- No ORM or second database driver.
- Reuse existing collection metadata and RBAC semantics instead of inventing duplicate configuration.
- Public access must remain fail-closed: the public role may exist by default, but it receives no collection permissions automatically.
- Tests should use Node's built-in test runner and existing dependencies where practical.
- Fast test commands must be concise and deterministic so coding agents do not need to read thousands of passing lines.

## Phase 1 — collection visibility

- [x] Expose existing collection `hidden` metadata as a clear `Show in Content` setting under Settings → Content Visibility.
- [x] Allow ordinary and M2M junction collections to be shown/hidden without changing their schema or data.
- [x] Keep M2M junction collections hidden by default.
- [x] Mark junction/hidden collections clearly so operators understand why they do not appear in Content.
- [x] Keep Content navigation derived only from non-system, non-hidden collections through one shared visibility helper.
- [x] Add focused source tests for hidden metadata plus a real-MySQL integration assertion for default-hidden M2M junction behavior.

## Phase 2 — public role and public content

- [x] Verify anonymous requests resolve through the public role and normal permission evaluation.
- [x] Ensure migration/bootstrap creates exactly one protected public role when none exists.
- [x] Require migration `0005-default-public-role` so existing installs cannot silently skip the new invariant.
- [x] Do not grant any public collection permission automatically.
- [x] Keep the public role configurable from Roles & Permissions so administrators can grant only the required actions and row/field restrictions.
- [x] Add tests proving anonymous access is fail-closed without permission and allowed only when the public role has the matching permission.
- [x] Add bootstrap/idempotency/migration tests for the default public role.

## Phase 3 — production-readiness audit

- [x] Re-check startup/configuration, migration compatibility, auth/session/token handling, RBAC, query validation, schema mutation guards, files/storage, audit logging, extensions and graceful shutdown.
- [x] Fix blockers/hazards found during review: request-id/body-parser ordering, malformed-JSON contract, bounded rate-limit buckets, explicit trusted-proxy hops and strict collection visibility metadata types.
- [x] Identify actual release blockers separately from optional scale/future work.
- [x] Write `docs/production-readiness.md` with the single-instance verdict, known limits and explicit environment gates.
- [x] Align deployment guidance with one-port Studio/API runtime, migration `0005`, public RBAC and trusted proxy configuration.
- [x] Update `todo.md` only for checks that genuinely require Node 24 runtime, MySQL, SMTP, S3, browser or deployment infrastructure.

## Phase 4 — low-noise comprehensive automated tests

- [x] Add root `test:fast` for deterministic security/behavior-critical tests with concise output.
- [x] Make root `npm test` discover and run the complete non-environment source suite.
- [x] Add targeted suites for collection visibility, public RBAC, request-id/malformed JSON and production configuration.
- [x] Add production guard coverage for bounded rate-limit memory, migration gating, fail-closed public access and strict metadata booleans.
- [x] Keep the normal source suites isolated from external network and real providers.
- [x] Make failures actionable by rerunning a failed quiet stage automatically with the detailed Node reporter.

## Phase 5 — full verification workflow for Codex

- [x] Add `scripts/verify.mjs` to run checks in stages and print only stage summaries unless a command fails.
- [x] Stage 1: fast or complete source/unit/security tests.
- [x] Stage 2: Studio production build + npm package dry-run contract checks.
- [x] Stage 3: opt-in real MySQL/API integration only when the explicit environment flags are present.
- [x] Guard the destructive integration suite so the DB name must contain `test`, `ci` or `dev` and destructive permission must be explicit.
- [x] Document `npm run test:fast` for normal Codex changes, `npm test` for complete source verification and `npm run test:release` before release.
- [x] Keep browser/MySQL/SMTP/S3 checks separate so everyday coding does not burn time/tokens on unavailable infrastructure.
- [x] Document the staged workflow in `AGENTS.md` and `docs/testing.md`.

## Delivery order

1. Plan only. — done
2. Collection visibility UI + focused tests. — done
3. Guaranteed public role bootstrap + public RBAC tests. — done
4. Production-readiness source audit/report + blocker fixes. — done
5. Fast/full/release test runners and missing regression suites. — done
6. Plan/todo status alignment and final branch diff review. — source status done; runtime/environment checks remain in `todo.md`

## Verification status

The source pass is complete. GitHub Actions were not used. This connector environment does not provide the checked-out Node 24/npm/MySQL/browser runtime needed to truthfully execute the new test commands, so the applicable execution gates remain explicit in `todo.md` rather than being marked passed from source inspection.
