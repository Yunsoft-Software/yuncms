# Studio interface

Studio uses one visual and interaction system for Content, Files, Data Model,
AI, Access and Settings. Both light and dark themes follow the branding and
accent selected under **Settings → Branding & Appearance**.

## Navigation

The application rail keeps each tool's icon and label visible. Content uses a
second context rail for collection and folder navigation. Files and Data Model
provide their own context views. On narrow screens the application rail moves
to the bottom and the collection menu is available from the menu control.

The command palette and keyboard shortcuts remain available. See
[Using Studio](studio.md#command-palette-and-keyboard-shortcuts).

## Lists and tables

Collection headings keep the collection name, API key, record/field counts and
new-record action together. Search, sorting, filters and column/density options
remain in a separate compact toolbar.

Long text never determines an unbounded row height. List previews clip long
values visually, preserving complete text in tooltips and record editors.
Translation and category/relation summaries display two entries plus a count.
UUIDs remain on one line. A large desktop table scrolls inside its own surface;
the document itself stays within the viewport. On tablet/mobile, content lists
use cards with the same values and permission-controlled actions.

## Editors and overlays

Select a row or **Quick edit** to open the inspector. **Open full editor** opens
the complete record page. Both use the same typed values and permissions.
New-record defaults come from the schema, rather than from the order of select
options. Forms retain complete long content and related records.

Dialogs, file previews, pickers and the command palette share theme surfaces,
keyboard focus behavior and clear close controls. Destructive actions continue
to require an explicit Studio confirmation dialog.

## Appearance and accessibility

Primary actions and selected navigation follow the configured accent. Text,
borders and surfaces use shared semantic tokens in both themes. Decorative
ambient gradients are not used in routine workspaces. Motion respects reduced
motion preferences; status labels do not rely on color alone.

Changing presentation does not change REST routes, collection schemas, stored
records, authentication providers, extension contracts or permissions.
