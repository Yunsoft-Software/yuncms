# YunCMS 0.1.4 release evidence

Date: 2026-08-22

Branch: `22-08-2026`

Reviewed source base: `0843c95`

This note records completed local release-candidate checks without credentials or secret configuration values. It is evidence for the checks named below, not a claim that the remaining deployment/provider scenarios in `todo.md` have passed.

## Environment

- Node.js `24.18.1`
- npm `11.16.0`
- mysql and mysqldump client `9.7.1`
- Database server `10.4.28-MariaDB`
- Normal integration database: `yuncms_test`
- Separate managed-upgrade database: `yuncms_upgrade_test`

## Completed gates

- `npm ci`: 130 packages installed, audit reported 0 vulnerabilities.
- `npm run test:fast`: 71 files passed. The fast list includes `packages/cli/test/update-dependency-section.test.js` and the other managed-upgrade regression files.
- `npm test`: 93 files passed.
- `npm run test:release`: 93 source files, Studio production build and all four package contracts passed.
- Release runner with `YUNCMS_TEST_MYSQL=1` and destructive-test acknowledgement: four real MySQL/API integration files passed against `yuncms_test`.
- Dedicated managed-upgrade integration: three tests passed, covering the cross-client maintenance lock, partial-DDL attempt journaling/fail-closed retry and a real mysqldump/destructive-restore project snapshot round-trip.
- An independent post-test query confirmed that `yuncms_upgrade_test` contained zero tables.
- Four `0.1.4` package tarballs were packed and installed together in a clean npm project. The install audit reported 0 vulnerabilities, `yuncms help` exposed the managed-upgrade commands, bootstrap applied migrations `0001` through `0012`, `/health` and `/ready` succeeded, and SIGINT produced a clean API shutdown.

## Review fixes included in the candidate

- Compatibility startup now blocks every unapplied failed/applying migration attempt, including an attempt for a future migration, while remaining compatible with pre-attempt-journal databases.
- The temporary post-update runtime probe now has a bounded TERM/KILL shutdown path and reports a deterministic timeout instead of waiting indefinitely.
- The CLI start signal regression no longer emits the synthetic test signal before the asynchronous maintenance check installs its handlers.

## Still pending

The npm session was not authenticated when the candidate was prepared. Publication, registry-only installation, published-target dry-run/first-transition update, forced rollback, real supervisor race, production MySQL 8/TLS/scale and S3-provider recovery checks remain pending in `todo.md` until executed in their required environments.
