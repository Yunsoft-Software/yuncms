# YunCMS Studio

Studio is the React 19.2/Vite 8 administration UI in `apps/studio`. It is generic/schema-driven rather than collection-specific.

## Authentication

Studio stores opaque access/refresh credentials in `sessionStorage`.

The API client:

- attaches the access token to bearer requests;
- serializes refresh so concurrent 401s do not start multiple refresh rotations;
- retries the original request once;
- clears the session and returns to login if refresh fails.

Login includes password-reset request mode. Reset/verification links are consumed through:

```text
?auth_action=reset&token=...
?auth_action=verify&token=...
```

## Content

Content supports:

- collection selection;
- generic record table;
- schema-generated create/edit form;
- create/update/delete;
- primitive controls for current V1 field types;
- loading/error/empty states;
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

Data Model supports:

- list/create/delete collections;
- list/create/delete fields;
- required/nullability mutation;
- create/delete M2O relations;
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

Roles/Permissions supports:

- create/rename/delete non-protected roles;
- create a public role;
- permission create/update/delete;
- collection/action selection;
- field allowlists;
- row-filter JSON;
- create/update prospective-record validation JSON.

Validation input is disabled for read/delete permissions because validation is a write-policy concept.

## Files

Files supports:

- metadata list;
- upload to default storage;
- authenticated download;
- title/download-filename edit;
- delete.

The REST layer can also upload to configured S3 with `?storage=s3`. A Studio storage selector and maintenance/reconciliation UI are optional operator UX; backend reconciliation already exists at `POST /files/reconcile`.

## Accessibility baseline

Controls use semantic buttons/forms/labels and focus styles. Formal keyboard/screen-reader/accessibility verification remains manual in `todo.md`.

## Local commands

```bash
npm run dev:studio
npm run build --workspace=@yuncms/studio
```

Build/runtime verification remains in `todo.md` until it is actually executed.
