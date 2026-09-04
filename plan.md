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
- [ ] Pass the complete and release test suites, including real MySQL/API integration and npm package dry runs.
- [ ] Publish the public npm packages and verify `latest` resolves to 0.1.16 for each package.

## After this release

- [ ] Complete only the environment-dependent verification items that remain in `todo.md` when the relevant environment is available.
- [ ] Add new platform features only when a real project establishes the requirement and update this plan before implementation.
