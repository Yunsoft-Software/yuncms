# YunCMS Studio UI Improvement Plan

This plan focuses on usability polish for the existing `16-08-2026` Studio implementation. Backend behavior, schema semantics and permission enforcement stay unchanged unless a UI requirement exposes a real API gap.

## Product goals

- Make ordinary content work feel like a CMS instead of an API test console.
- Keep frequently used content and files one click away.
- Move structural/admin tools out of the primary content navigation and into a clear Settings area.
- Replace prompt-driven and raw-JSON-first workflows with guided controls while keeping advanced rules available.
- Keep the UI lightweight: React/Vite only, no new UI framework or icon package unless a later requirement proves necessary.
- Preserve the current REST API contracts and Directus-inspired concepts without copying Directus UI/source.

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
- [x] Add lightweight client-side search for the currently loaded page of records.
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

## Delivery order

1. Sidebar/navigation grouping and collection sub-navigation. — done
2. Content toolbar/list cleanup. — done
3. Files gallery + in-page metadata editor. — done
4. Data Model master/detail and focused create flow. — done
5. Role-first permission matrix and advanced editor. — done
6. Shared responsive/accessibility polish and runtime smoke. — source polish done; formal accessibility/runtime checks remain
7. Single-port Studio/API runtime. — source implementation done; runtime smoke remains

## Verification

Source changes can be reviewed through the repository connector in this environment, but the final Studio build/runtime/browser verification remains part of `todo.md` when a local Node/browser environment is unavailable. Do not mark runtime-only checks complete from source inspection alone.
