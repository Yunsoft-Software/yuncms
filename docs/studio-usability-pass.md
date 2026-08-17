# YunCMS Studio Usability Pass

This pass improves only the usability and presentation of features that already exist on branch `16-08-2026`. It must not add a new backend capability, new product module, new dependency, or GitHub Actions workflow.

## Goals

- Make every data-heavy screen readable before it becomes crowded.
- Use one pagination component everywhere instead of hand-building previous/next controls per screen.
- Keep primary actions obvious while moving search/filter/sort/pagination into a consistent secondary control layer.
- Make Files behave like an actual media library: visible thumbnails for previewable files, predictable placeholders for the rest, and previews loaded only for the visible page.
- Make Data Model and Roles & Permissions understandable without requiring users to scan long technical lists.
- Preserve all current API contracts and permission semantics.

## Phase A — shared UI primitives

- [ ] Add one reusable `Pagination` component that supports page number, total count, page size, page-size choices, loading state and compact mode.
- [ ] Remove screen-specific pagination markup from Content and route it through the shared component.
- [ ] Use the same pagination component for Files, Users, Data Model collection/field lists and Roles/Permissions role/collection lists where the data is already loaded client-side.
- [ ] Keep pagination responsive and keyboard accessible.
- [ ] Reset the active page whenever search/filter/sort changes.

## Phase B — Files library

- [ ] Replace global eager thumbnail loading with a reusable per-card preview component that loads only visible previewable files.
- [ ] Detect previewable images from MIME type and safe filename extension fallback so older metadata does not silently lose thumbnails.
- [ ] Remove the arbitrary 12 MB thumbnail exclusion from the UI path; preview failure must degrade to a placeholder instead of appearing broken.
- [ ] Add clear preview loading/error states inside cards.
- [ ] Paginate filtered/sorted gallery and list results through the shared pagination component.
- [ ] Keep Gallery/List, search, type filter and sort state while paging.
- [ ] Keep upload, edit, download and delete behavior unchanged.

## Phase C — Users workspace

- [ ] Keep the user list as the primary view and make `New user` a compact secondary panel.
- [ ] Paginate filtered/sorted users with the shared component.
- [ ] Improve row readability with role/status/verification badges while preserving inline role/status editing.
- [ ] Keep self-protection and verification actions unchanged.
- [ ] Make empty/search states and result counts consistent with the rest of Studio.

## Phase D — Data Model workspace

- [ ] Make the collection sidebar easier to scan with a compact header, counts and shared pagination.
- [ ] Paginate project/system collection search results without changing collection semantics.
- [ ] Paginate field search/sort results through the same pagination component.
- [ ] Collapse `Add field` into an explicit action so schema inspection stays visually primary.
- [ ] Keep Fields/Relations tabs, M2O/M2M creation and destructive safeguards unchanged.
- [ ] Improve field rows with clearer type/required/read-only hierarchy and less action noise.

## Phase E — Roles & Permissions workspace

- [ ] Paginate role search/sort results through the shared component.
- [ ] Paginate filtered permission-matrix collections through the shared component.
- [ ] Add a compact selected-role summary (role type + configured rule count) without changing RBAC behavior.
- [ ] Keep simple permission toggles in the matrix, but improve labels and sticky scan behavior.
- [ ] Move advanced field/filter/validation editing into the existing modal layer so Configure does not send the user far below the matrix.
- [ ] Preserve administrator/public protections and all current permission API calls.

## Phase F — final consistency pass

- [ ] Standardize list header spacing, counters, badges, pagination placement and narrow-screen behavior across Content, Files, Users, Data Model and Roles & Permissions.
- [ ] Verify source-level state transitions for page resets, filtered totals and stale requests.
- [ ] Update `plan.md` and this checklist only for behavior actually implemented.
- [ ] Leave real browser/build/runtime smoke items open in `todo.md` when they cannot be truthfully executed in the current environment.

## Commit order

1. Plan only.
2. Shared Pagination component + Content migration.
3. Files preview reliability + Files pagination.
4. Users pagination/readability.
5. Data Model pagination/layout polish.
6. Roles & Permissions pagination/modal polish.
7. Shared responsive styling + checklist/status updates.

## Constraints

- No GitHub Actions.
- Small focused commits.
- No new npm package.
- No backend feature expansion unless a UI-only implementation is impossible with the current API; if such a gap is found, document it before changing backend behavior.
- Do not mark runtime/browser verification complete from source review alone.
