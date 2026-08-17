# Environment / Manual TODO

Only checks that still require a real checkout, browser, MySQL instance or deployment provider belong here. Completed history is intentionally removed; source implementation status lives in `plan.md`.

## 1. Codex / Node 24 release checks

Run on branch `16-08-2026` from a fresh Node.js 24 checkout.

- [ ] Run `npm run test:fast`; fix only real failures. This now includes port-3008, O2O, auth role-name, file/image field, rich file preview, localization, sidebar, dark-mode and Roles/Permissions source regressions.
- [ ] Run `npm test`; confirm the complete auto-discovered core/API/CLI/extensions/Studio suite passes.
- [ ] Run `npm run test:release`; confirm source tests, Studio production build and all publishable `npm pack --dry-run` contracts pass.
- [ ] Inspect the production Studio build for unresolved translation keys or JSX/build errors introduced by the new Data Model, sidebar, file preview and permission UI.

## 2. Fresh init / port 3008

- [ ] In a new empty project run `yuncms init`; inspect generated `.env` and confirm `PORT=3008`, `STUDIO_ORIGIN=http://localhost:3008` and `AUTH_PUBLIC_URL=http://localhost:3008`.
- [ ] Start the generated project and verify API + built Studio are served from the same listener on `http://localhost:3008`.
- [ ] If an existing local project still has the legacy generated `PORT=8055` or `STUDIO_ORIGIN=http://localhost:5173`, replace those old `.env` values with the 3008 same-origin values before testing; committed defaults cannot overwrite an existing untracked `.env` safely.

## 3. Real MySQL schema / relation checks

Use a disposable MySQL 8-compatible database whose name clearly contains `test`, `ci` or `dev`.

- [ ] Run `YUNCMS_TEST_MYSQL=1 YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 npm run test:release`.
- [ ] Create an optional UUID field, create an O2O relation from it, and inspect MySQL: the source field must have both the expected FK and one UNIQUE index while relation metadata reports `kind: "o2o"`.
- [ ] Insert one row using a target id, then try a second source row with the same target id; MySQL/API must reject the duplicate target link.
- [ ] Delete the O2O relation and verify the FK + UNIQUE index disappear while the underlying UUID field/data remain intact.
- [ ] Exercise O2O with `RESTRICT`, `CASCADE` and optional-field `SET NULL`; verify required fields reject `SET NULL`.
- [ ] Create File and Image fields through Studio and inspect metadata: physical type must be `uuid`, interface must be `file`/`image`, and normal primitive fields must remain unchanged.

## 4. Studio Data Model / Content browser smoke

- [ ] Data Model → Add Field: verify Short text, primitive fields, File and Image choices are understandable, the form stays compact, and File/Image creation does not expose raw UUID implementation details to the user.
- [ ] Relations: verify M2O / O2O / M2M type cards, existing-relation summary, create/delete flows and validation messages. File/Image UUID fields must not appear as relation-source choices.
- [ ] Content: create/edit a record with a File field by choosing an existing file and by uploading a new file directly from the field control; verify persisted value reloads correctly.
- [ ] Content: repeat with an Image field; picker must be image-only and table/form preview must render the selected image.
- [ ] Verify optional File/Image fields can be cleared and required ones cannot be cleared to an empty value.
- [ ] Verify rich authenticated previews in Files and Content: image thumbnail, embedded PDF, playable video, playable audio, and a clean placeholder for unsupported formats.
- [ ] Test missing/deleted referenced files and failed preview downloads; UI must degrade without breaking record editing.
- [ ] Re-run Content search/filter/sort/pagination with file/image fields present; file filters must use readable file names instead of raw UUID entry.

## 5. Sidebar / identity / branding browser smoke

- [ ] Verify Content, Library and Settings are independent accordion groups with readable icons and keyboard-operable expand/collapse controls.
- [ ] Collapse the whole sidebar to the icon rail and expand it again; selected section/context must remain intact. Re-check narrow-screen behavior.
- [ ] Verify no “YunCMS Studio” copy is rendered beside the logo.
- [ ] Under the signed-in email verify the human-readable role name is shown and the raw role UUID never appears. Re-check after access-token refresh and full page reload.
- [ ] With default Yunsoft branding, verify Light theme uses the approved light logo and Dark theme uses the approved dark logo; System must follow the OS/browser scheme.
- [ ] Set a custom logo and switch Light/Dark/System; the custom logo must remain unchanged while the Yunsoft powered-by/copyright footer remains visible in the expanded UI/auth screens.
- [ ] Verify the exact production URL used for the Yunsoft dark logo resolves successfully; if Yunsoft does not publish that asset or CSP/network policy blocks it, set an approved hosted dark-logo URL before release.

## 6. Dark-mode / UI usability pass

- [ ] Visually inspect Login, Content, Files, file previews, Users, Data Model, relation cards, Roles & Permissions, advanced permission modal, Content Visibility, Appearance, pagination/filter controls and confirmations in both Light and Dark modes; there must be no accidental white legacy surfaces in Dark mode.
- [ ] Roles & Permissions: verify Public role shows the anonymous-access warning, access summary counts are correct, simple action toggles remain quick, and field/row/validation restrictions stay behind Configure.
- [ ] Test keyboard focus order, Escape/modal behavior, accordion controls, file picker controls, visible focus rings and basic screen-reader labels.
- [ ] Walk the new/changed flows once in English and once in Turkish and verify no untranslated key strings appear.

## 7. Deployment-only hardening

- [ ] Behind the actual reverse proxy, configure exact `TRUST_PROXY_HOPS`; verify session IP and auth rate-limit buckets use the intended client IP. Confirm `TRUST_PROXY_HOPS=0` ignores forwarded addresses for direct deployments.
- [ ] Configure HSTS at the actual TLS/reverse-proxy layer and verify it there.
- [ ] If production uses S3-compatible storage, test the real provider: upload/list/download/delete, credential-chain behavior, reconciliation dry-run/age guard, multi-page inventory and redacted provider errors.

## 8. Final release decision

- [ ] Only after the applicable checks above pass, update the production-readiness decision for the actual deployment environment.
