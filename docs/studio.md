# Using YunCMS Studio

YunCMS Studio is the browser administration interface for content, data models, Files, users, roles, permissions, appearance and the built-in AI assistant. In a normal installation Studio and the REST API use the same origin and port.

After starting YunCMS, open the configured URL, usually:

```text
http://localhost:3008
```

If this is your first installation, complete [Getting Started](getting-started.md) before using this page as a feature reference.

## Sign in

The login screen supports normal email/password authentication and displays any configured external authentication providers. When an Administrator enables public registration, it also exposes account creation and the optional verification-resend flow.

If you forget a local password, use the password-reset option. Reset and verification links return to Studio and are completed against the normal authentication API.

Studio keeps opaque session credentials in browser session storage, refreshes an expired access token when possible and sends you back to login if the session can no longer be refreshed.

See [Authentication](auth.md) to configure OIDC, OAuth2, LDAP or SAML login methods.

# Navigation

Studio uses a workbench layout with a stable application rail and task-specific navigation beside the active workspace.

The application rail opens:

- **Content** — project collections that are visible in content navigation;
- **Files** — uploaded assets and media;
- **Data Model** — collections, fields, relations and the schema graph;
- **AI** — the built-in assistant when configured;
- **Access** — roles, permissions and user administration;
- **Settings** — appearance and integration settings available to the current account.

The visible navigation is not an authorization boundary. Roles and permissions decide what a user can actually read or change.

When a tool has its own structure, Studio keeps that context nearby. Content shows collection navigation, Files shows asset categories, Data Model shows schema resources, and Access keeps role navigation beside the permission workspace.

On narrow screens the application rail becomes a compact bottom navigation and contextual controls adapt to the available width. Existing record cards, drawers and full-width editing surfaces remain available where a desktop table would be impractical.

<p align="center">
  <img src="assets/screenshots/studio-mobile-menu.png" alt="YunCMS mobile navigation menu" width="360">
</p>

## Command palette and keyboard shortcuts

Use **Ctrl+K** on Windows/Linux or **Command+K** on macOS to open the command palette. The palette can:

- open major Studio tools;
- find visible collections by display name or API key;
- start the primary action for the current workspace, such as creating a record, uploading a file, creating a collection, role or user.

Use the arrow keys to move through results, **Enter** to open the selected command and **Escape** to close the palette.

When focus is not already inside an editable control, press **/** to focus the visible workspace search field.

## Organize collections

Data Model lets you organize content navigation with one-level folders and ordering. Folders affect presentation only; they do not create database tables or relations.

Collections can be:

- reordered;
- placed in a navigation folder;
- hidden from the Content menu;
- presented as singleton content when appropriate.

A hidden collection can still be accessed through the API if the caller's role has permission.

# Content

Select a collection directly from **Content** to work with its records.

![YunCMS Content workspace](assets/screenshots/studio-content.png)

The Content workbench opens with a bounded collection identity surface showing live record and field counts, followed immediately by the quiet data controls and table/card work area. It provides:

- record table/list navigation;
- create and full-page edit routes;
- quick record editing in an inspector without leaving the list;
- delete actions when permitted;
- current-page row selection and bulk deletion;
- configurable visible columns and table density;
- search, sorting and a contextual filter panel;
- form controls generated from field metadata;
- searchable relation pickers for supported direct relations;
- relation labels instead of raw relation IDs when target records are readable;
- file/image previews for Files-backed fields;
- readable boolean, status, date/time, empty and JSON values;
- loading, empty and error states;
- responsive record cards on narrow screens.

Only operations allowed by your effective role are available. If an API permission prevents an action, the backend remains authoritative even if a client attempts the request manually.

## Search, filter and view options

Search uses readable text fields in the current collection. Filters can be added without keeping the full filter builder permanently open, and active filters remain visible as removable chips.

The **View** control lets you choose which table columns are visible and switch between compact, comfortable and relaxed row density. Studio initially shows the first six useful table columns to keep row actions readable; any additional managed or project fields remain available from **View**. At least one table column remains visible.

Column sorting is applied through the normal Items API query behavior. These presentation controls do not change collection schema or stored records.

## Create a record

1. Open the collection under **Content**.
2. Choose the create/new-record action.
3. Fill the generated form.
4. Select related records where the field uses a relation picker.
5. Save.

Required fields and write-field restrictions are validated by the API. System fields such as creation/update timestamps and users are filled automatically when configured for the collection.

On mobile, records become readable cards rather than forcing the desktop table into a narrow viewport:

<p align="center">
  <img src="assets/screenshots/studio-mobile-content.png" alt="YunCMS mobile content cards" width="360">
</p>

## Edit a record

Select a table row or **Quick edit** to open the record inspector. The inspector uses the same record fields and save API as the full editor and is intended for fast changes while preserving the current list context.

Choose **Open full editor** when you need the complete record route or want a shareable/deep-linkable editing location.

Role field allowlists and row filters are applied again on update; viewing a page in Studio does not bypass them.

## Bulk actions

The table can select records on the current page. Bulk deletion always uses the normal permission-checked delete endpoint for each selected record and asks for confirmation through Studio's shared dialog system.

If only part of a bulk operation succeeds, Studio reports the partial failure instead of presenting the whole action as successful.

## Relations in forms

For direct many-to-one relations, Studio chooses a readable label from the target collection in this order when available:

1. `name`;
2. `title`;
3. `label`;
4. another visible string/text field;
5. target key/id.

Relation fields use a searchable picker rather than relying on a long native select list. The picker reads target data through the normal Items API, so target collection/row/field permissions are still enforced.

For the full relation model, including reverse and M2M querying, see [Data model](data-model.md) and [Items query language](api-query-language.md).

# Data Model

Open **Data Model** from the application rail to create and maintain project collections.

![YunCMS Data Model navigation editor](assets/screenshots/studio-data-model.png)

## Collections

From the collection workspace you can:

- create a collection;
- inspect project and system collections separately;
- change display/navigation metadata;
- control Content-menu visibility;
- mark an appropriate collection as singleton;
- delete project collections through the destructive flow;
- organize collections into one-level navigation folders;
- drag/drop to reorder collections and folders.

Display names are for humans; collection API keys are the stable identifiers used by REST, permissions and integrations. Avoid changing integration keys after external clients depend on them.

## Fields

The **Fields** tab lets you inspect/add/remove fields and adjust supported schema properties such as required/nullability. Field rows use type-specific icons so text, numeric, boolean, date/time, UUID, relation and Files-backed fields are easier to distinguish while scanning a schema.

Current storage types include:

```text
integer
bigint
decimal
string
text
boolean
date
datetime
timestamp
json
uuid
```

File and image controls use UUID-backed fields linked to the Files library.

See [Data model](data-model.md) for type limits, defaults and system fields.

## Schema graph

The **Schema graph** provides a read-only relationship view derived from the current collections and relations. System collections are hidden by default so project structure remains readable.

Selecting a graph node highlights connected collections and opens schema details. The graph does not create, delete or modify schema by drag-and-drop; schema mutations remain explicit actions in the normal collection, field and relation screens.

## Relations

The **Relations** area supports relation lifecycle management including:

- many-to-one (M2O);
- one-to-one (O2O) where configured;
- reverse one-to-many/one-to-one views derived from stored relations;
- managed many-to-many (M2M) junctions.

Before creating a direct or M2M relation, Studio shows a relation preview with the selected collections, field or junction name and resulting structure. For direct relations it also displays the chosen delete behavior.

Destructive M2M removal explicitly warns that junction link records are removed and calls the guarded schema endpoint with destructive intent.

# Files

Open **Files** for the media/file library.

![YunCMS Files gallery](assets/screenshots/studio-files.png)

The Files workbench supports:

- gallery view;
- list view;
- contextual categories for All, recent uploads, images, video, audio, PDF and other files;
- authenticated image thumbnails and media previews;
- placeholders for unsupported/non-image previews;
- search by title, filename, MIME type or storage metadata;
- sorting and pagination;
- whole-workspace drag/drop staging;
- multi-file upload queue;
- explicit queued, uploading, completed and failed states;
- retry for failed queue items;
- partial-failure reporting without invented percentage progress;
- quick asset inspection without leaving the library;
- full file detail routes;
- authenticated download;
- editable title/download filename metadata;
- delete when permitted.

The **Last 7 days** category is calculated from each asset's `uploaded_at` value and is only a library view filter; it does not alter Files records.

Dropping files into the library stages them for the upload screen. YunCMS does not upload a dropped file until you explicitly start the upload.

Files is permission-managed. A non-Administrator role can receive exactly the read/create/update/delete access it needs, and the Public role can intentionally receive filtered read access for public galleries/assets.

See [Files](files.md).

# Users

Open **Access** and then **Users** to manage accounts when your role has user-management access.

Supported administration includes:

- list users;
- create users;
- assign/update allowed roles;
- change account status;
- inspect email-verification state;
- send verification mail when SMTP is configured;
- delete permitted users.

Protected Administrator/account invariants remain enforced by the API. Delegated user-management access is not equivalent to full Administrator access.

# Roles & Permissions

Open **Access** to work with roles and permissions.

![YunCMS collection permission matrix](assets/screenshots/studio-permissions.png)

The normal workflow is role-first:

1. select or create a role;
2. find the collection/resource;
3. toggle `Read`, `Create`, `Update` or `Delete` for simple grants;
4. open a permission to configure field, row or write-validation restrictions;
5. save and test with an account assigned to that role.

The permission workspace presents each collection with four stable action columns. Each action communicates whether access is disabled, unrestricted or restricted. System-protected actions remain visibly distinct and cannot be changed through an ordinary role.

The permission matrix can also show explicitly delegatable system resources such as Users, Files and Roles.

## Advanced permission rules

Advanced rules support:

- field allowlists;
- row filters;
- create/update prospective-record validation.

For straightforward AND rules, Studio provides a visual rule builder. Choose a field, condition and value for each rule and Studio serializes the result to the same permission JSON format used by the API.

**Advanced JSON** remains available at all times. If an existing filter contains nested structures, `_or` logic or another shape that cannot be represented safely by the visual editor, Studio preserves that JSON unchanged and keeps it in Advanced JSON mode instead of attempting a lossy conversion.

Validation input is relevant to create/update permissions, not ordinary read/delete grants.

The Public role uses the same explicit grant model. This makes intentional public collections and filtered public Files possible without introducing a separate hard-coded public-access system.

See [Roles and permissions](permissions.md).

# Appearance and branding

Studio branding/settings can control project-facing elements such as:

- project/site name;
- logo;
- favicon;
- accent/presentation preferences supported by the settings screen;
- navigation presentation.

Logo and favicon assets point to YunCMS Files records rather than arbitrary unvalidated asset paths.

See [Studio customization](studio-customization.md).

## Public registration

Administrators configure default-off public signup under **Settings → Appearance → Public Registration**. A normal authenticated role must be selected before signup can be enabled; Administrator and Public roles are never eligible. Email verification can be required when SMTP is configured.

See [Public registration](public-registration.md) before enabling signup.

# AI assistant

When configured by an Administrator, the Studio AI assistant can help inspect schema/content and, when explicitly allowed, perform bounded data operations through YunCMS services.

The AI workspace emphasizes the actual CMS operations returned by the assistant. Successful and failed schema/item operations are shown alongside the response so it is clear what happened.

Read, write and full access modes remain explicit. The assistant does not receive an Administrator bypass simply because it is AI. Tool calls use the current user's normal role/accountability, and write access also depends on AI-specific write/access-mode controls.

See [AI assistant](ai-assistant.md) before enabling data-changing tools.

# Accessibility and motion

Studio uses shared dialogs, inspectors, command palette and picker controls with keyboard focus management. Important actions should not depend on hover alone, and state labels remain textual even when color also reinforces them.

When the operating system requests reduced motion, Studio removes workspace transitions, overlay movement and smooth scrolling while preserving the final state immediately.

# Running Studio

A normal installed project uses one public listener:

```bash
npx yuncms start
```

The generated process-manager entry is equivalent for hosted deployments:

```bash
node start.js
```

The Studio build is served by the YunCMS API process, so normal production deployment does not require a separate frontend web server/port.

For project setup, initialization and managed update commands, use [Setup and CLI](setup-cli.md).

# Troubleshooting common access questions

## “I can see a collection but cannot edit it”

Navigation visibility and authorization are separate. Check the current role's update permission, row filter and write-field allowlist.

## “A relation target is missing from the picker”

Check read access on the target collection and any target row filter. Relation pickers obey target RBAC.

## “A public image returns unauthorized/not found”

Check both the content collection permission and `yuncms_files:read`. If Files read has a row filter, verify that the selected Files record matches it.

## “An external sign-in button does not appear”

Check `AUTH_PROVIDERS` and the provider configuration, then verify `/auth/providers` returns the provider metadata. Browser providers also require a sufficiently long `AUTH_STATE_SECRET`.

## Related guides

- [Setup and CLI](setup-cli.md)
- [Data model](data-model.md)
- [Roles and permissions](permissions.md)
- [Files](files.md)
- [Authentication](auth.md)
- [Public registration](public-registration.md)
- [AI assistant](ai-assistant.md)
