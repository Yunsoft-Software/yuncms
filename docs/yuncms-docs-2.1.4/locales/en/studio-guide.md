# Using YunCMS Studio (YunCMS 2.1.4)

> **Published Version:** `YunCMS 2.1.4` · **Git Tag:** `v2.1.4` · **Commit:** `6bb66f3fdfefe2f27bde7c2d96f9c494d1c2c45e`

YunCMS Studio is the browser administration workspace bundled inside **YunCMS 2.1.4**. It shares the same origin and port as the REST API (`http://localhost:3008` by default) and enforces every role permission through the backend API.

## Navigation, shortcuts and localization

The left application rail switches between major workspaces:

- **Content** — browse, search, filter, create, edit, and delete records in visible project collections.
- **Files** — upload, preview, filter, and manage local or S3-compatible media assets.
- **Data Model** — create collections, fields, relations, folders, and inspect the read-only schema graph.
- **AI** — permission-aware Studio assistant when enabled and configured by an Administrator.
- **Access** — manage Roles, Permissions, and Users.
- **Settings** — Features and license, Two-factor authentication, MCP Connection, Flows, and Branding & Appearance.

Productivity shortcuts:

- Press **Ctrl+K** (Windows/Linux) or **Cmd+K** (macOS) to open the command palette.
- Press **/** outside text fields to focus the workspace search input.

### Localization

YunCMS `2.1.4` Studio natively supports **8 languages**: English (`en`), Turkish (`tr`), Spanish (`es`), German (`de`), French (`fr`), Brazilian Portuguese (`pt-BR`), Japanese (`ja`), and Simplified Chinese (`zh-CN`). Users can switch their personal language on the login screen or under **Settings → Branding & Appearance**; Administrators can also set the project default language.

## Content workspace

Select any visible collection under **Content** to work with its records:

![YunCMS 2.1.4 Content workspace](screenshot:studio-content-en)

Core Content capabilities in `2.1.4`:

- **Search, sort and filter**: query readable text fields, sort by supported columns, and apply structured filters without losing context.
- **Quick edit and full editor**: inspect or edit a record in a side drawer or open its full page route.
- **Optimistic concurrency protection**: Studio sends `Prefer: yuncms-edit-state` and `x-yuncms-item-revision` on tracked updates and deletes. When another user saves first, Studio preserves your unsaved draft and prompts you to compare before saving again.
- **Unsaved-change confirmation**: leaving a modified Content or Flow form opens a confirmation dialog so edits are not lost accidentally.
- **Date vs timestamp clarity**: `date` fields preserve exact `YYYY-MM-DD` calendar dates across browser timezones; `datetime` and `timestamp` fields format in the user's locale and timezone.
- **Configurable table view**: open **View** to choose visible columns and switch between compact, comfortable, and relaxed density.

### System-managed record fields

Choose **View → Columns** to show configured, readable `created_at`, `updated_at`, `created_by` and `updated_by` fields. Existing record details show these fields as read-only values, and mobile cards respect your selection.

![System-managed fields shown in the list](screenshot:studio-accountability-en)

## Files library

Open **Files** to upload and organize assets stored on local disk or S3-compatible object storage:

![YunCMS 2.1.4 Files gallery](screenshot:studio-files-en)

- Switch between **Gallery** and **List** views and filter by type (Images, Video, Audio, PDF, Other, or Last 7 days).
- Edit file download names, titles, and JSON metadata, or select uploaded files directly from `file` and `image` collection fields.
- File previews and downloads honor `yuncms_files:read` permissions and row filters.

## Responsive mobile experience

On narrow viewports (`390px` and similar phones), Studio switches tables to readable record cards and moves workspace switching into a compact bottom bar with a slide-over menu drawer:

| Mobile Content cards | Mobile navigation drawer |
| --- | --- |
| ![YunCMS 2.1.4 mobile Content cards](screenshot:studio-mobile-content-en) | ![YunCMS 2.1.4 mobile navigation menu](screenshot:studio-mobile-menu-en) |

## Branding, Flows and AI overview

- **Branding & Appearance**: configure theme (light/dark), accent color, language defaults, and optional public registration. Custom Studio name, logo, and favicon require an active Premium entitlement with `whiteLabel` enabled (see [Features, Licensing and Production Operations (YunCMS 2.1.4)](doc:licensing-and-operations)).
- **Flows**: build visual automations triggered by manual actions, collection events, webhooks, or cron schedules with native data operations, branches, AI generation nodes, and persistent run history.
- **MCP Connection**: disabled and read-only by default; Administrators can configure bounded MCP tool access under **Settings → MCP Connection**.

Continue to [Data Model, Permissions and REST API (YunCMS 2.1.4)](doc:data-and-access).
