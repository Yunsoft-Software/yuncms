# Pre-merge verification checklist

These checks require a local checkout and browser environment. Complete them before merging the Studio Next changes into the main branch, then remove this file when the checklist is empty.

- [ ] Run the Studio test suite and confirm the new shell contracts pass with the existing navigation, appearance, routing, mobile and accessibility tests.
- [ ] Run the Studio production build and confirm there are no Vite or React warnings introduced by the new application frame.
- [ ] Smoke-test Content at desktop widths around 1440px and 1280px. Confirm the application rail, collection context rail, table controls and collection navigation remain usable.
- [ ] Smoke-test Files, Data Model and AI. Confirm these workspaces correctly use the wider workbench layout without leaving an empty context rail.
- [ ] Smoke-test Roles, Users, Appearance and MCP. Confirm the existing contextual settings navigation still works alongside the new application rail.
- [ ] Smoke-test mobile widths around 390px and 430px. Confirm the bottom application rail does not cover forms, pagination, dialogs or destructive actions.
- [ ] Verify keyboard focus on every application-rail destination and confirm active destinations expose `aria-current="page"`.
- [ ] Verify reduced-motion mode disables shell and rail transitions without removing state feedback.
- [ ] Check light mode, dark mode and at least one customized accent color for contrast and selected-state clarity.
- [ ] Confirm supported browser targets handle the `:has()` shell selectors used to remove unnecessary context rails from Files, AI and Data Model.
- [ ] Capture replacement Studio screenshots only after the workbench layout is stable enough to represent the shipped interface.
