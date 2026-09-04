# Pre-merge verification checklist

These checks require a local checkout and browser environment. Complete them before merging the Studio Next changes into the main branch, then remove this file when the checklist is empty.

- [ ] Run the Studio test suite and confirm the new shell, workspace, command palette, schema graph, shared-component and native-dialog contracts pass with the existing navigation, appearance, routing, mobile and accessibility tests.
- [ ] Run the Studio production build and confirm there are no Vite, JSX or React warnings introduced by the new application frame and workspace layers.
- [ ] Smoke-test Content at desktop widths around 1440px and 1280px. Confirm the application rail, collection context rail, compact filter controls, table controls and collection navigation remain usable.
- [ ] Smoke-test Files in grid and list views. Confirm previews, search, type filters, sorting, pagination, upload, detail, edit, download and delete behavior still work with the asset-browser presentation.
- [ ] Smoke-test Data Model collection creation, overview, fields and relations. Confirm field type icons render correctly and existing schema mutations behave exactly as before.
- [ ] Smoke-test the read-only Schema Graph with direct, one-to-one and many-to-many relations. Confirm selecting a node highlights connected nodes, the inspector reports the correct relations, system collections are hidden by default and opening a collection returns to its existing Data Model route.
- [ ] Verify the Schema Graph remains read-only and performs no schema mutation requests.
- [ ] Smoke-test AI. Confirm setup, settings, read/write/full access selection, conversation history and operation result states remain functional without the previous decorative treatment.
- [ ] Smoke-test Roles, Users, Appearance and MCP. Confirm existing permissions, account, branding, registration and integration behavior still works alongside the new application rail.
- [ ] Open the command palette with Ctrl+K and Command+K, navigate with arrow keys, invoke with Enter, close with Escape and verify focus remains trapped while the palette is open.
- [ ] Verify `/` focuses the visible workspace search field only when focus is not already inside an input, textarea, select or editable element.
- [ ] Confirm the command palette contextual action matches the current workspace: new record, upload file, new collection, new role or new user where applicable.
- [ ] Smoke-test mobile widths around 390px and 430px. Confirm the bottom application rail does not cover forms, pagination, dialogs or destructive actions and the graph/asset/permission layouts remain usable.
- [ ] Verify keyboard focus on every application-rail destination and confirm active destinations expose `aria-current="page"`.
- [ ] Verify reduced-motion mode disables shell, graph, palette and workspace transitions without removing state feedback.
- [ ] Check light mode, dark mode and at least one customized accent color for contrast and selected-state clarity.
- [ ] Confirm supported browser targets handle the `:has()` shell selectors used to remove unnecessary context rails and to hide application navigation on the authentication surface.
- [ ] Confirm all shared Studio components remain exported from `apps/studio/src/components/index.js` and no screen introduces a duplicate modal/dialog primitive.
- [ ] Confirm there are no browser-native `alert`, `prompt` or `confirm` calls anywhere under `apps/studio/src`.
- [ ] Capture replacement Studio screenshots only after the workbench layout is stable enough to represent the shipped interface.
