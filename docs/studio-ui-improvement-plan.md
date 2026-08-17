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

- [ ] Split the sidebar into `Content`, `Library` and `Settings` groups.
- [ ] Render non-system collections directly below `Content` as nested navigation items instead of selecting a collection from a toolbar dropdown.
- [ ] Keep the current collection selection stable while moving between record create/edit/list states.
- [ ] Put `Files` in the primary workspace/library area.
- [ ] Move `Data Model`, `Users` and `Roles & Permissions` under `Settings`.
- [ ] Keep API health/account information visually secondary in the sidebar/footer.
- [ ] Add clear empty-navigation affordance that sends a new installation to Data Model when no user collections exist.

## Phase 2 — content workspace

- [ ] Remove the collection `<select>` from the Content toolbar once sidebar collection navigation is available.
- [ ] Use the selected collection as the page title/context and keep `New record` as the primary action.
- [ ] Improve empty states so the first useful action is obvious.
- [ ] Make table action placement consistent and reduce visual noise around metadata.
- [ ] Add lightweight client-side search for the currently loaded page of records.
- [ ] Keep relation pickers readable; the existing 200-item relation limit remains a documented V1 scale constraint.
- [ ] Later polish: add pagination/search-backed relation selection when the API supports it cleanly.

## Phase 3 — Files as a media/library experience

- [ ] Make gallery/grid the default Files view.
- [ ] Show authenticated image thumbnails through object URLs; use simple type placeholders for non-image files.
- [ ] Add grid/list view switching without changing API behavior.
- [ ] Add file search/filter by filename/title/MIME type.
- [ ] Replace metadata edit `window.prompt()` calls with an in-page editor/details panel.
- [ ] Make upload a clear drop/select area and show the selected filename before upload.
- [ ] Keep download/delete available from each card/row and make destructive actions visually secondary until invoked.

## Phase 4 — Data Model / collection builder

- [ ] Treat Data Model as a settings workspace with a collection master/detail layout.
- [ ] Replace the always-visible create form with a deliberate `New collection` action and focused creation panel.
- [ ] Separate `Fields` and `Relations` into simple tabs/sections so first-time users are not shown every schema concept at once.
- [ ] Present fields as readable rows/cards with type and required status; keep destructive actions in a secondary/danger area.
- [ ] Keep M2O and M2M controls, but add short plain-language descriptions near target field/collection choices.
- [ ] Keep system collections identifiable but visually de-emphasized and non-destructive.

## Phase 5 — roles and permissions

- [ ] Use a role-first master/detail layout instead of mixing role creation, permission creation and all permission rows on one screen.
- [ ] Show collection permissions as a matrix: `Read`, `Create`, `Update`, `Delete`.
- [ ] Allow simple permissions to be toggled directly from the matrix.
- [ ] Open advanced permission details only when needed for field allowlists, row filters and write validation.
- [ ] Replace permission edit `window.prompt()` flows with an in-page advanced editor.
- [ ] Keep raw JSON available for advanced filter/validation rules, but explain what each rule affects and validate JSON before save.
- [ ] Keep administrator/public role protections visible in the UI.

## Phase 6 — shared interaction polish

- [ ] Standardize primary/secondary/danger button sizing and placement.
- [ ] Standardize empty, loading, success and error states.
- [ ] Improve mobile/narrow-screen sidebar behavior without adding a dependency.
- [ ] Add visible focus states and ensure all interactive controls have labels.
- [ ] Avoid modal/prompt-only workflows for important edits.
- [ ] Keep destructive confirmation explicit for schema, role, record and file deletion.

## Delivery order

1. Sidebar/navigation grouping and collection sub-navigation.
2. Content toolbar/list cleanup.
3. Files gallery + in-page metadata editor.
4. Data Model master/detail and focused create flow.
5. Role-first permission matrix and advanced editor.
6. Shared responsive/accessibility polish and runtime smoke.

## Verification

Source changes can be reviewed through the repository connector in this environment, but the final Studio build/runtime/browser verification remains part of `todo.md` when a local Node/browser environment is unavailable. Do not mark runtime-only checks complete from source inspection alone.
