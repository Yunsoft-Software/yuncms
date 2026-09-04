# Pre-merge verification checklist

These checks require a local checkout and browser environment. Complete them before merging the Studio Next changes into the main branch, then remove this file when the checklist is empty.

- [ ] In Content, verify row click opens the quick inspector, saving refreshes the list, opening the full editor keeps the existing deep-link route, and Escape/focus return work correctly.
- [ ] In Content, verify current-page selection, select-all, bulk delete confirmation, partial delete errors, pagination resets and inspector selection do not interfere with one another.
- [ ] In Content, verify relation fields and relation filters use the searchable relation picker, including required values, optional empty values and existing values that are not present in the first lookup page.
- [ ] In Content, verify column visibility never allows a zero-column table and compact/comfortable/relaxed density changes presentation without changing queries or saved data.
- [ ] Smoke-test Files in grid and list views. Confirm previews, search, category filters, sorting, pagination, detail, edit, download and delete behavior still work with the asset-browser presentation.
- [ ] Verify the Files context rail shows correct counts for All, Images, Video, Audio, PDF, Other and Last 7 days, and that the mobile type selector remains in sync with the same filter state.
- [ ] Verify whole-workspace file drag-and-drop stages files before upload and does not trigger an upload without an explicit submit action.
- [ ] Verify multi-file upload handles queued, uploading, done and failed states, retries failed items, reports partial failures accurately and never displays invented percentage progress.
- [ ] Smoke-test Data Model collection creation, overview, fields and relations. Confirm field type icons render correctly and existing schema mutations behave exactly as before.
- [ ] Verify relation creation previews M2O, O2O and M2M structure correctly before submit, including selected field, target collection, junction name and on-delete behavior.
- [ ] Smoke-test the read-only Schema Graph with direct, one-to-one and many-to-many relations. Confirm selecting a node highlights connected nodes, the inspector reports the correct relations, system collections are hidden by default and opening a collection returns to its existing Data Model route.
- [ ] Verify the Schema Graph remains read-only and performs no schema mutation requests.
- [ ] Smoke-test Roles and permissions. Confirm field allowlists, filters and validation save through the existing permission API contract.
- [ ] Verify the visual rule builder round-trips supported simple AND rules and preserves unsupported nested, `_or` or custom JSON unchanged in Advanced JSON mode.
- [ ] Smoke-test Users, Appearance and MCP. Confirm existing account, branding, registration and integration behavior still works alongside the new application rail.
- [ ] Smoke-test AI. Confirm setup, settings, read/write/full access selection, conversation history and operation result states remain functional without the previous decorative treatment.
- [ ] Open the command palette with Ctrl+K and Command+K, navigate with arrow keys, invoke with Enter, close with Escape and verify focus remains trapped while the palette is open.
- [ ] Verify `/` focuses the visible workspace search field only when focus is not already inside an input, textarea, select or editable element.
- [ ] Confirm the command palette finds collections by display name and API key and exposes the correct contextual action: new record, upload file, new collection, new role or new user where applicable.
- [ ] Smoke-test mobile widths around 390px and 430px. Confirm the bottom application rail does not cover forms, pagination, dialogs or destructive actions and the graph, asset, permission and inspector layouts remain usable.
- [ ] Verify keyboard focus on every application-rail destination and confirm active destinations expose `aria-current="page"`.
- [ ] Verify reduced-motion mode disables shell, graph, palette, inspector and workspace transitions without removing state feedback.
- [ ] Smoke-test a browser without CSS `:has()` support within the intended compatibility range and confirm explicit route/auth shell classes preserve Files, AI, Data Model and authentication layouts.
