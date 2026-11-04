# Studio interface

Studio uses one visual and interaction system for Content, Files, Data Model,
AI, Access and Settings. Both light and dark themes follow the branding and
accent selected under **Settings → Branding & Appearance**.
Studio waits for the saved appearance and language before displaying its forms.

## Navigation

The application rail keeps each tool's icon and label visible. Content uses a
second context rail for collection and folder navigation. Files and Data Model
provide their own context views. On narrow screens the application rail moves
to the bottom and the collection menu is available from the menu control.
The compact navigation is used through 1100 CSS pixels, keeping tablet and
narrow window workspaces clear of the two desktop rails. The menu opens over
the workspace without pushing the page down. Close
it with the close button, outside backdrop or Escape. Keyboard focus stays
within the open menu and returns to its button when closed.

The command palette and keyboard shortcuts remain available. See
[Using Studio](studio.md#command-palette-and-keyboard-shortcuts).

## Lists and tables

Collection headings keep the collection name, API key, record/field counts and
new-record action together. Search, sorting, filters and column/density options
remain in a separate compact toolbar.

Long text never determines an unbounded row height. List previews clip long
values visually, preserving complete text in tooltips and record editors.
Translation and category/relation summaries display two entries plus a count.
Relation choices use one readable translation in the Studio language, with the
first available translation as a fallback. A readable title, name, email or
translation summary makes the UUID column optional by default; it remains
available under **View → Columns**. Row actions use labeled icons with tooltips.
UUIDs remain on one line. A large desktop table scrolls inside its own surface;
the document itself stays within the viewport. On tablet/mobile, content lists
use cards with the same values and permission-controlled actions.
Lists with up to two visible data columns retain their compact table when the
workspace has at least 700 pixels available; narrower lists use cards. Card
actions share one row whenever space allows.

The file list adapts to its available workspace width. Compact tables prioritize
the name, size, upload date and all four actions; MIME type and storage remain
available in the file details. On phones each file becomes a labeled card with
the same preview, download, edit and delete actions.

## Editors and overlays

Select a row or **Quick edit** to open the inspector. **Open full editor** opens
the complete record page. Both use the same typed values and permissions.
New-record defaults come from the schema, rather than from the order of select
options. Forms retain complete long content and related records.
`bigint` fields preserve decimal strings exactly, including integers above
JavaScript's safe integer range. This applies to record and nested editors,
custom user fields, numeric content filters and visual permission rules; REST responses retain the
native MySQL decimal-string representation.
Language tabs stay in one horizontally scrollable strip as languages are added.
Use Left/Right arrows to switch tabs, or Home/End to reach the first/last language.
Translation cards follow a language's `rtl` direction when configured in the
language collection.
Large many-to-many pickers keep their searchable choices in a bounded scrolling
area; selecting records does not remove them from the editor or truncate saved
relationships.
Single- and multiple-relation choices show at most two lines, with complete labels retained in
their tooltips and search matching. Long names do not enlarge the selection control.
Relation choices, translated labels and nested record summaries load all native
API pages. A record with more than 500 links retains its complete selection.
If list membership changes during a paginated load, reload the record before
saving; Studio does not accept that incomplete relation draft.
Failed nested-record reads also block saving and show the request error instead
of presenting the related records as an empty, editable selection.

Flows use a readable initial canvas scale. Use the settings panel's **First
operation**, **On success** and **On failure** selectors to connect nodes without
dragging. Narrow workspaces stack the canvas and settings; the panel fields
adapt to the available width. AI content generation lives in the Flow operation
palette; existing AI rules and their preserved history are accessible from the
Flow list.

Dialogs, file previews, pickers and the command palette share theme surfaces,
keyboard focus behavior and clear close controls. Destructive actions continue
to require an explicit Studio confirmation dialog.

## Appearance and accessibility

Primary actions and selected navigation follow the configured accent. Text,
borders and surfaces use shared semantic tokens in both themes.
Typography uses a locally served Inter variable font with regular body text,
medium controls and semibold headings. Editors and inspector overlays share
the same typography and checkbox alignment.
Accent labels and links use theme-aware text colors so they remain legible on
dark surfaces, including field-type badges, generated keys and recommendations.
Decorative ambient gradients are not used in routine workspaces. Motion respects reduced
motion preferences; status labels do not rely on color alone.

Changing presentation does not change REST routes, collection schemas, stored
records, authentication providers, extension contracts or permissions.
