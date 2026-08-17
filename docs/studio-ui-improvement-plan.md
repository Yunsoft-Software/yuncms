# YunCMS Studio UI Improvement Plan

This plan focuses on usability polish for the existing `16-08-2026` Studio implementation. Backend behavior, schema semantics and permission enforcement stay unchanged unless a UI requirement exposes a real API gap.

## Product goals

- Make ordinary content work feel like a CMS instead of an API test console.
- Keep frequently used content and files one click away.
- Move structural/admin tools out of the primary content navigation and into a clear Settings area.
- Replace prompt-driven and raw-JSON-first workflows with guided controls while keeping advanced rules available.
- Keep the UI lightweight: React/Vite only, no new UI framework or icon package unless a later requirement proves necessary.
- Preserve the current REST API contracts and Directus-inspired concepts without copying Directus UI/source.
- Make large lists easier to scan by giving every data-heavy workspace an obvious search/filter/sort path.
- Prefer server-side data controls when the API already supports them; do not pretend a current-page-only sort is a full dataset sort.

## Phase 1 — information architecture and navigation

- [x] Split the sidebar into `Content`, `Library` and `Settings` groups.
- [x] Render non-system collections directly below `Content` as nested navigation items instead of selecting a collection from a toolbar dropdown.
- [x] Keep the current collection selection stable while moving between record create/edit/list states.
- [x] Put `Files` in the primary workspace/library area.
- [x] Move `Data Model`, `Users` and `Roles & Permissions` under `Settings`.
- [x] Keep API health/account information visually secondary in the sidebar/footer.
- [x] Add clear empty-navigation affordance that sends a new installation to Data Model when no user collections exist.

## Phase 2 — content workspace

- [x] Remove the collection `<select>` from the Content toolbar once sidebar collection navigation is available.
- [x] Use the selected collection as the page title/context and keep `New record` as the primary action.
- [x] Improve empty states so the first useful action is obvious.
- [x] Make table action placement consistent and reduce visual noise around metadata.
- [x] Add lightweight client-side search for the currently loaded page of records as the initial usability pass.
- [x] Keep relation pickers readable; the existing 200-item relation limit remains a documented V1 scale constraint.
- [ ] Later polish: add pagination/search-backed relation selection when the API supports it cleanly.

## Phase 3 — Files as a media/library experience

- [x] Make gallery/grid the default Files view.
- [x] Show authenticated image thumbnails through object URLs; use simple type placeholders for non-image files.
- [x] Add grid/list view switching without changing API behavior.
- [x] Add file search/filter by filename/title/MIME type.
- [x] Replace metadata edit `window.prompt()` calls with an in-page editor/details panel.
- [x] Make upload a clear drop/select area and show the selected filename before upload.
- [x] Keep download/delete available from each card/row and make destructive actions visually secondary until invoked.

## Phase 4 — Data Model / collection builder

- [x] Treat Data Model as a settings workspace with a collection master/detail layout.
- [x] Replace the always-visible create form with a deliberate `New collection` action and focused creation panel.
- [x] Separate `Fields` and `Relations` into simple tabs/sections so first-time users are not shown every schema concept at once.
- [x] Present fields as readable rows/cards with type and required status; keep destructive actions in a secondary/danger area.
- [x] Keep M2O and M2M controls, but add short plain-language descriptions near target field/collection choices.
- [x] Keep system collections identifiable but visually de-emphasized and non-destructive.

## Phase 5 — roles and permissions

- [x] Use a role-first master/detail layout instead of mixing role creation, permission creation and all permission rows on one screen.
- [x] Show collection permissions as a matrix: `Read`, `Create`, `Update`, `Delete`.
- [x] Allow simple permissions to be toggled directly from the matrix.
- [x] Open advanced permission details only when needed for field allowlists, row filters and write validation.
- [x] Replace permission edit `window.prompt()` flows with an in-page advanced editor.
- [x] Keep raw JSON available for advanced filter/validation rules, but explain what each rule affects and validate JSON before save.
- [x] Keep administrator/public role protections visible in the UI.

## Phase 6 — shared interaction polish

- [x] Standardize primary/secondary/danger button sizing and placement across the refreshed workspaces.
- [x] Standardize empty, loading, success and error states across the refreshed workspaces.
- [x] Improve mobile/narrow-screen sidebar and settings workspace behavior without adding a dependency.
- [ ] Complete the formal keyboard/focus/labels/screen-reader review tracked in `todo.md`.
- [x] Avoid modal/prompt-only workflows for important metadata/role/permission edits.
- [x] Keep destructive confirmation explicit for schema, role, record and file deletion.

## Phase 7 — single-port monorepo runtime

- [x] Build the React Studio into `packages/api/studio-dist` so the API package owns the runtime bundle.
- [x] Use the current browser origin as the Studio API URL by default; `VITE_API_URL` remains an explicit override.
- [x] Serve `/` and `/assets/...` from the built bundle with Node filesystem streams; no additional static-server package.
- [x] Keep API routes on the same Express listener/port.
- [x] Make root `npm start` build Studio first and then start the API listener.
- [x] Align default `STUDIO_ORIGIN` and `AUTH_PUBLIC_URL` with the API port.
- [x] Add source-level path traversal coverage for the Studio asset resolver.
- [ ] Run a real build/start smoke and verify Studio HTML/assets/API/auth links all work on one port — `todo.md`.

## Phase 8 — shared list controls and scanability

- [x] Add a compact control-strip pattern for search, filter, sort, result count and clear/reset actions.
- [x] Add reusable visual treatment for active filter chips and compact select controls without adding a dependency.
- [x] Keep data controls responsive so they stack cleanly on narrow screens.
- [x] Make filtered/visible counts explicit so users understand whether they are looking at all records or a subset.

## Phase 9 — Content data explorer

- [x] Replace current-page-only search with server-backed search across readable text fields.
- [x] Add field-aware filters using the existing REST filter operators and combine multiple active filters with AND semantics.
- [x] Add server-backed sorting with ascending/descending direction.
- [x] Add page-size selection plus previous/next pagination using API `limit`, `offset` and filtered `total_count` metadata.
- [x] Reset pagination when search/filter/sort/page-size changes so users never land on an empty stale page.
- [x] Show active filters as removable chips and provide one-click reset.

## Phase 10 — Files library controls

- [x] Add file-type filtering for images, video, audio, PDF and other files.
- [x] Add useful sort presets for newest/oldest, name and file size.
- [x] Show visible-result counts and a clear-filters affordance in both Gallery and List views.
- [x] Keep the same search/filter/sort state when switching Gallery/List.

## Phase 11 — Users, Data Model and permission-heavy settings

- [x] Users: collapse creation behind a clear `New user` action so the user list remains the primary workspace.
- [x] Users: add search, role/status filters and useful sort options with visible result counts.
- [x] Data Model: add collection search/sort in the master sidebar and field search/sort in the Fields tab.
- [x] Roles & Permissions: add role search/sort and collection filtering so large permission matrices remain manageable.
- [x] Roles & Permissions: add a quick `configured only` view for auditing granted access.

## Phase 12 — interaction refinements

- [x] Make sortable/filterable toolbars visually consistent across Content, Files, Users, Data Model and Roles & Permissions.
- [x] Keep primary actions visually separate from list controls so `New record`, `Upload`, `New user`, `New collection` and `New role` stay obvious.
- [x] Keep destructive actions out of dense filter toolbars and preserve explicit confirmation dialogs.
- [ ] Re-run source/build/runtime/browser verification after the data-control pass; environment-only checks remain in `todo.md`.

## Delivery order

1. Sidebar/navigation grouping and collection sub-navigation. — done
2. Content toolbar/list cleanup. — done
3. Files gallery + in-page metadata editor. — done
4. Data Model master/detail and focused create flow. — done
5. Role-first permission matrix and advanced editor. — done
6. Shared responsive/accessibility polish and runtime smoke. — source polish done; formal accessibility/runtime checks remain
7. Single-port Studio/API runtime. — source implementation done; runtime smoke remains
8. Shared list-control styling + server-backed Content sort/filter/pagination. — done
9. Files type filtering/sort presets. — done
10. Users list-first workflow + search/filter/sort. — done
11. Data Model and Roles/Permissions search/filter polish. — done
12. Final consistency pass and runtime verification. — source implementation done; runtime/browser verification remains

## Verification

Source changes can be reviewed through the repository connector in this environment. GitHub Actions must not be used. The final Studio build/runtime/browser verification remains part of `todo.md` when a local Node/browser environment is unavailable; do not mark runtime-only checks complete from source inspection alone.
