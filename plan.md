# YunCMS Live Development Plan

> Branch baseline: `24-08-2026`.
>
> This is a **remaining source-work checklist**. Completed implementation history has been removed. Environment-dependent execution/verification belongs only in `todo.md`.

Engineering rules live in [`AGENTS.md`](AGENTS.md) and apply to every item below: Node 24, JavaScript/ESM, Express 5, MySQL + `mysql2/promise`, REST only, explicit accountability, service-layer authorization, no self-HTTP, no GitHub Actions, small focused commits, and regression coverage with each behavior change.

## 0. Current Studio usability pass

- [x] Move Yapay Zeka provider/model/write/limit configuration from environment variables into administrator-managed persisted settings in Studio without exposing the saved API key back to clients.
- [x] Move MCP enablement, authentication, host/origin, write-tool and result-limit configuration from environment variables into administrator-managed persisted settings in Studio, applying updates without a server restart.
- [ ] Complete the existing collection `singleton` metadata contract so Studio exposes it, Content bypasses the list page, and service-layer creates cannot produce a second singleton item.
- [x] Replace the Data Model collection landing page with a compact Directus-like list: inline visibility toggle, dimmed hidden rows, six-dot drag handle, native drag/drop ordering, and navigation-only parent groups.
- [x] Make Content a focused navigation mode: entering Content shows only the content collection/group tree plus a clear way back to the main Studio modules.
- [ ] Keep field/relation/detail screens functionally intact while simplifying collection navigation and reducing duplicate controls/copy.

## 1. Query engine — remaining Directus-like depth

Detailed requirements: [`docs/roadmap-query-engine.md`](docs/roadmap-query-engine.md).

- [ ] Add permission-aware direct to-one relational filtering without accepting raw SQL or bypassing target row/field RBAC.
- [ ] Add permission-aware direct to-one relational sorting with correct SQL ordering before pagination.
- [ ] Add bounded relation-local (`deep`) filter/sort/limit options after relational filter/sort primitives are stable, including hard per-parent/total to-many caps and query-cost accounting.

Do not add arbitrary SQL/query functions unless a concrete product need appears.

## 2. Multi-host deployment / managed-upgrade hardening

The current managed updater is deliberately maintenance-window based. These are separate future source improvements, not claims about the current updater.

- [ ] Design and implement a distributed maintenance/read-write barrier for deployments with multiple active API hosts/containers sharing one DB/storage. The current local project marker + MySQL maintenance lock serialize the existing maintenance workflow but operators must still stop all application replicas.
- [ ] Add atomic release-directory/symlink deployment and a bounded rolling handoff if YunCMS needs zero/near-zero-downtime managed upgrades instead of maintenance windows.
- [ ] Add cryptographically authenticated/signed backup manifests if the threat model includes an attacker who can rewrite both backup content and the current SHA-256 manifest.

## 3. Studio / schema usability at larger scale

- [ ] Move Files/Users/relation-picker search and pagination server-side where client-side filtering becomes too expensive for large datasets.
- [ ] Add generic value editors for custom extension columns inside specialized Users/Files/Roles record screens.
- [ ] Add a dedicated migration workflow for enabling accountability fields (`created_at`, `updated_at`, `created_by`, `updated_by`) on project collections that already contain data.

## 4. Higher-assurance optional security

These should stay separate from the current authentication/provider and Files implementation rather than being mixed into completed roadmaps.

- [ ] Add a dedicated local-account MFA roadmap/implementation (at minimum TOTP + recovery codes) if deployments require YunCMS-managed MFA rather than upstream IdP MFA.
- [ ] Add an optional malware/antivirus scanning policy and operational integration for deployments that accept untrusted file uploads.

## Deliberate current boundaries

The following are **not active source tasks** without a demonstrated product/performance need:

- generic REST response/data caching merely because Redis exists;
- Redis as an authoritative database/session store;
- an untrusted extension marketplace sandbox;
- a durable distributed job queue;
- GraphQL or a second database/ORM layer.

## Verification

Do not add execution gates here. Node/npm, full test suites, real MySQL/Redis, multi-process scheduler/shared-state, OIDC/OAuth2/LDAP/SAML, MCP clients, Studio browser flows and managed-upgrade integration checks are maintained as pending executable work in [`todo.md`](todo.md) until they are actually run successfully.
