# YunCMS plan

This file is the source of truth for implementation and release status. Detailed product behavior belongs in `docs/`; checks that are blocked on a particular browser, credential or external service belong in `todo.md`.

## Product baseline

- [x] Node.js 24, Express 5 and MySQL-only REST runtime.
- [x] Direct service layer for items, collections, fields, relations, users and files.
- [x] Explicit accountability, RBAC, authentication/session handling and public access boundaries.
- [x] React Studio workbenches for Content, Files, Data Model, AI, Access and Settings.
- [x] Extension helpers, AI integration and MCP runtime with permission-aware service access.
- [x] Operator and developer documentation under `docs/`.

## 0.1.15 — Studio kinetic visual system

- [x] Establish the coral–magenta–teal product spectrum and warm-light/near-black-dark surfaces.
- [x] Add bounded Content and Data Model identity surfaces without turning data panels into decorative cards.
- [x] Keep default Content columns readable while preserving every field in View options.
- [x] Align inspectors, actions, Files, Access, Appearance and the AI setup state with the shared visual language.
- [x] Add restrained ambient motion with a complete reduced-motion fallback.
- [x] Verify light, dark and customized-accent presentation in a real browser.
- [x] Verify 390, 430, 760, 768, 1024, 1280 and 1440 pixel layout boundaries without horizontal overflow.
- [x] Replace desktop and mobile Studio documentation screenshots with the release-candidate interface.
- [x] Pass the fast and complete source suites.
- [x] Pass `npm run test:release` after the final version update, including real MySQL/API integration.
- [x] Publish the public npm packages and verify `latest` resolves to 0.1.15 for each package.

## 0.1.16 — responsive visual hardening

- [x] Replace the 760px breakpoint seam with one 900px tablet/mobile contract across the Studio shell and workspaces.
- [x] Switch dense Content tables to readable record cards before constrained desktop widths can overlap sticky actions.
- [x] Keep Files workspace controls full-width and preserve the horizontal category rail on tablet layouts.
- [x] Restore persistent Content action contrast and use the semantic danger color in light and dark themes.
- [x] Prevent the permission collection grid from inheriting the legacy two-column layout and clipping action controls.
- [x] Add regression coverage for responsive breakpoints, tablet record cards, toolbar sizing, permission layout and action contrast.
- [x] Verify 390, 768, 1024 and 1440 pixel layouts in a real browser across light and dark themes with no horizontal overflow or console errors.
- [x] Pass the complete and release test suites, including real MySQL/API integration and npm package dry runs.
- [x] Publish the public npm packages and verify `latest` resolves to 0.1.16 for each package.

## 0.1.17 — contextual permissions and Studio visual QA

- [x] Add parameterized `$CURRENT_USER`, `$CURRENT_ROLE`, `$NOW` and signed `$NOW(...)` filter values without weakening deny-by-default accountability.
- [x] Apply dynamic values consistently to API filters, permission filters, relation reads, Files scopes and create/update validation.
- [x] Expose supported dynamic values in the Studio visual rule builder and document YunCMS' deliberate V1 scope.
- [x] Replace the clipped permission cards with a Directus-inspired collection-by-action matrix across desktop, tablet and mobile layouts.
- [x] Replace the wrapped mobile “Open menu” control with a compact, accessible navigation trigger.
- [x] Visually inspect every Studio workspace in light and dark themes at desktop, tablet and mobile sizes, then correct release-blocking layout defects.
- [x] Replace the empty split sign-in surface with a responsive, project-logo-aware brand panel and keep auth action screens consistent.
- [x] Correct the routed upload workspace so its heading, dropzone and queue use the full content width.
- [x] Pass the fast, complete and release suites, including real MySQL/API integration and npm package dry runs.
- [x] Publish the public npm packages and verify `latest` resolves to 0.1.17 for each package.

## After this release

- [ ] Complete only the environment-dependent verification items that remain in `todo.md` when the relevant environment is available.
- [ ] Add new platform features only when a real project establishes the requirement and update this plan before implementation.
