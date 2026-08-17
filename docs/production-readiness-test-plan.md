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

- [ ] Expose existing collection `hidden` metadata as a clear `Show in Content` setting in Data Model.
- [ ] Allow ordinary and M2M junction collections to be shown/hidden without changing their schema or data.
- [ ] Keep M2M junction collections hidden by default.
- [ ] Mark junction/hidden collections clearly in Data Model so operators understand why they do not appear in Content.
- [ ] Verify Content navigation continues to render only non-system, non-hidden collections.
- [ ] Add focused source tests for hidden metadata and default-hidden M2M junction behavior.

## Phase 2 — public role and public content

- [ ] Verify anonymous requests resolve through the public role and normal permission evaluation.
- [ ] Ensure bootstrap creates exactly one protected public role when none exists.
- [ ] Do not grant any public collection permission automatically.
- [ ] Keep the public role configurable from Roles & Permissions so administrators can grant only the required `Read` access and optional row/field restrictions.
- [ ] Add tests proving anonymous access is fail-closed without permission and allowed only when the public role has the matching permission.
- [ ] Add bootstrap/idempotency tests for the default public role.

## Phase 3 — production-readiness audit

- [ ] Re-check startup/configuration, migration compatibility, auth/session/token handling, RBAC, query validation, schema mutation guards, files/storage, audit logging, extensions and graceful shutdown.
- [ ] Identify actual release blockers separately from optional scale/future work.
- [ ] Write a concise production-readiness report with code references and explicit manual/environment checks.
- [ ] Update `todo.md` only for checks that genuinely require MySQL, SMTP, S3, browser or deployment environment.

## Phase 4 — low-noise comprehensive automated tests

- [ ] Add a root `test:fast` command for deterministic source/unit/API-contract tests with concise reporter output.
- [ ] Add a root `test:core` command for the complete non-environment test suite.
- [ ] Add targeted suites for collection visibility, public RBAC, API route contracts and Studio utility/state behavior where practical without a browser dependency.
- [ ] Add production guard tests for dangerous defaults and security-critical configuration semantics.
- [ ] Keep tests isolated from external network and real providers.
- [ ] Make failures actionable: test names should identify the broken capability directly.

## Phase 5 — full verification workflow for Codex

- [ ] Add a small script that runs the correct checks in stages and prints only stage summaries unless a command fails.
- [ ] Stage 1: source/unit/security tests.
- [ ] Stage 2: Studio build + API/package build checks.
- [ ] Stage 3: optional environment integration tests only when required environment variables are present.
- [ ] Document one short command Codex should run after normal changes and one broader command before release.
- [ ] Keep browser/MySQL/SMTP/S3 checks explicitly separate so everyday coding does not burn time/tokens on unavailable infrastructure.

## Delivery order

1. Plan only.
2. Collection visibility UI + focused tests.
3. Guaranteed public role bootstrap + public RBAC tests.
4. Production-readiness source audit/report.
5. Fast/full test runners and missing regression suites.
6. Plan/todo status alignment and final branch diff review.
