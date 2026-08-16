# YunCMS Studio

Studio is the React 19.2/Vite 8 administration UI in `apps/studio`.

It is intentionally generic and schema-driven rather than a collection-specific application.

## Authentication

Studio stores the current opaque access/refresh credentials in `sessionStorage`.

The API client:

- attaches the access token to bearer requests;
- serializes refresh so concurrent 401 responses do not start multiple refresh rotations;
- retries the original request once with the rotated access token;
- clears the session and returns to login when refresh fails.

Login includes a password-reset request mode. Reset/verification mail links are handled through URL query parameters:

```text
?auth_action=reset&token=...
?auth_action=verify&token=...
```

The token is consumed through the corresponding auth API and removed from the browser URL when the flow finishes.

## Content

The Content screen:

- loads available schema collections;
- selects a collection;
- loads records with generic `/items/:collection` REST;
- renders a generic table;
- creates/edits/deletes records;
- builds primitive controls from field metadata;
- supports string/text/integer/bigint/decimal/boolean/date/datetime/timestamp/json/uuid input basics;
- shows loading/error/empty states.

Relation expansion/display labels are intentionally not a full Directus-style relational explorer yet. Relation fields currently use the generic primitive record form unless a later relation-picker enhancement is added.

## Data Model

The Data Model screen uses the administrator `/schema` API to:

- list/create/delete collections;
- list/create/delete fields;
- toggle required/nullability through the physical field mutation API;
- create/delete M2O relations;
- create M2M junctions;
- display current relation metadata.

Destructive operations require explicit confirmation and send the API's `destructive=true` flag where required.

The backend supports high-level M2M junction deletion; the Studio M2M delete control can be expanded further as UX is refined.

## Users

The Users screen supports:

- list users;
- create a user with password/role/status;
- change role/status;
- prevent dangerous current-admin self-disable/delete actions;
- delete other users;
- display email verification status;
- send a verification email when SMTP is configured.

## Roles & Permissions

The Roles/Permissions screen supports:

- create/rename/delete non-protected roles;
- mark a new role public;
- create/update/delete permission records;
- configure collection/action;
- field allowlists;
- row filter JSON.

The backend also supports create/update `validation` rules. Studio can expose a dedicated validation editor as the permission UX is refined; the REST/service capability already exists.

## Files

The Files screen supports:

- list file metadata;
- upload to the default storage driver;
- authenticated download;
- edit title/download filename;
- delete.

The current UI uploads to default local storage. The REST API can target configured S3-compatible storage using `?storage=s3`; a storage-selector UI is optional follow-up UX rather than a backend requirement.

## Accessibility baseline

Current controls use semantic buttons/forms/labels and keyboard-focus styles. Formal accessibility verification is still a manual/local task and is not considered complete solely from source inspection.

## Local commands

```bash
npm run dev:studio
npm run build --workspace=@yuncms/studio
```

Build/runtime verification remains in `todo.md` until executed locally.
