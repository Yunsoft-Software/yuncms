# YunCMS Studio

Studio is the React 19.2/Vite 8 administration UI in `apps/studio`. It is generic/schema-driven rather than collection-specific.

The built Studio is served by the YunCMS API process itself. There is no second production Studio port or runtime static-server dependency: Vite writes the bundle to `packages/api/studio-dist`, and the API serves `/` plus `/assets/...` from that directory with Node filesystem streams.

## Authentication

Studio stores opaque access/refresh credentials in `sessionStorage`.

The API client:

- uses the current browser origin as the API URL by default;
- supports `VITE_API_URL` only as an explicit development override;
- attaches the access token to bearer requests;
- serializes refresh so concurrent 401s do not start multiple refresh rotations;
- retries the original request once;
- clears the session and returns to login if refresh fails.

Login includes password-reset request mode. Reset/verification links are consumed through:

```text
?auth_action=reset&token=...
?auth_action=verify&token=...
```

With the normal single-port setup, `AUTH_PUBLIC_URL` and `STUDIO_ORIGIN` default to the API port as well.

## Navigation

The primary Studio navigation is intentionally task-oriented:

- `Content` contains non-system collections directly as nested menu items;
- `Library` contains Files;
- `Settings` contains Data Model, Users and Roles & Permissions.

This avoids forcing users to choose a collection from a toolbar dropdown before every content task. If there are no user collections yet, the sidebar sends the administrator directly to Data Model.

API health, API address and account controls remain secondary in the sidebar footer.

## Content

Content supports:

- direct collection navigation from the sidebar;
- generic record table;
- schema-generated create/edit form;
- create/update/delete;
- primitive controls for current V1 field types;
- loading/error/empty states;
- lightweight search across the currently loaded record page;
- direct M2O relation pickers;
- direct M2O display labels in tables.

For relation pickers Studio chooses a readable target label using this order:

1. `name`;
2. `title`;
3. `label`;
4. first visible string/text field;
5. target key/id.

The V1 picker loads up to 200 readable target records through the normal `/items` API, so target RBAC remains effective. Search/paginated relation-picker UX for very large target sets is a later UI optimization.

Generic M2M content editing is intentionally not faked as a relation multi-select; M2M remains an explicit junction lifecycle in V1.

## Data Model

Data Model is a settings-style collection builder with collection master/detail navigation.

It supports:

- list/create/delete collections;
- focused `New collection` creation instead of an always-visible form;
- project/system collection separation;
- Fields and Relations tabs;
- list/create/delete fields;
- required/nullability mutation;
- readable field rows with type/required state;
- create/delete M2O relations with plain-language delete behavior labels;
- create M2M junctions;
- group M2M metadata by junction;
- destructive high-level M2M junction delete.

M2M deletion calls the backend lifecycle endpoint with explicit `destructive=true` and warns that junction link records will be removed.

## Users

Users supports:

- list/create users;
- role/status updates;
- current-admin self-disable/delete protection;
- delete other users;
- email verification status;
- send verification mail when SMTP is configured.

## Roles & Permissions

Roles/Permissions now uses a role-first workflow.

It supports:

- create/rename/delete non-protected roles;
- create and identify the public role;
- visibly identify the administrator role and its full-access bypass;
- select one role at a time;
- view collection permissions as a `Read` / `Create` / `Update` / `Delete` matrix;
- toggle simple all-field permissions directly from the matrix;
- open advanced rules only for permissions that need field/row/write restrictions;
- field allowlists through field checkboxes;
- row-filter JSON;
- create/update prospective-record validation JSON;
- JSON validation before advanced rules are submitted.

Validation input is disabled for read/delete permissions because validation is a write-policy concept. Important role and permission editing no longer depends on `window.prompt()`.

## Files

Files is a media/library workspace rather than only a metadata table.

It supports:

- gallery view by default;
- authenticated image thumbnails through blob URLs;
- file-type placeholders for non-image assets;
- gallery/list view switching;
- search by title, filename, MIME type or storage;
- drag/drop or file-picker upload;
- selected-file name/size feedback before upload;
- authenticated download;
- in-page title/download-filename editing;
- delete.

The REST layer can also upload to configured S3 with `?storage=s3`. A Studio storage selector and maintenance/reconciliation UI are optional operator UX; backend reconciliation already exists at `POST /files/reconcile`.

## Single-port runtime

The normal monorepo flow is:

```text
apps/studio --Vite build--> packages/api/studio-dist
                                  |
                                  v
                         Express listener :3008
                         /            Studio HTML
                         /assets/...   Studio assets
                         /auth/...     API
                         /items/...    API
                         /schema/...   API
                         ...
```

No new static serving package is used. The API only serves the generated index and asset paths; unrelated paths continue through the normal API/auth routing.

`packages/api` includes `studio-dist` in its package file list, so the published `@yunsoft/yuncms-api` package carries the prebuilt Studio bundle.

## Accessibility baseline

Controls use semantic buttons/forms/labels and visible focus styles. The refreshed screens include narrow-layout behavior, but formal keyboard/screen-reader/accessibility verification remains manual in `todo.md`.

## Local commands

Run the normal one-port workspace:

```bash
npm start
```

This builds `@yunsoft/yuncms-studio` and then starts the API listener. For source development without a second HTTP server:

```bash
npm run dev
```

`npm run dev` builds Studio once and starts the watched API process; rerun the Studio build after frontend source changes. Direct Vite development remains possible only as an explicit separate-origin workflow with `VITE_API_URL`/`STUDIO_ORIGIN` overrides.

The source workspace and clean public-registry install have both been verified with the single API/Studio listener.
