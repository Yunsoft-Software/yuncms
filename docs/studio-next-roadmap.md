# YunCMS Studio Next

YunCMS Studio Next is the next interface direction for YunCMS. The goal is to make everyday content, file, schema and access work faster while giving the Studio a clearer identity of its own.

The redesign keeps the existing YunCMS principles: a focused MySQL backend, predictable REST APIs, explicit permissions, extensibility, a lightweight React Studio and no unnecessary platform complexity.

## What is changing

Studio is moving from a traditional administration dashboard layout to a workbench layout built around four areas:

1. **Application rail** — the stable top-level tools such as Content, Files, Data Model, AI, Access and Settings.
2. **Context rail** — navigation that changes with the active tool, such as collections, file categories, roles or settings sections.
3. **Workbench** — the main area for tables, media, schema editing, permissions and other focused tasks.
4. **Inspector** — an optional side panel for quick record, file, field or permission details without losing the current workspace.

```text
┌──────┬────────────────────┬───────────────────────────────────────┬──────────────────────┐
│ APP  │ CONTEXT            │ WORKBENCH                             │ INSPECTOR            │
│ RAIL │ RAIL               │                                       │ optional             │
│      │                    │ resource / view / actions             │ selected record      │
│      │ collections        ├───────────────────────────────────────┤ selected file        │
│      │ file categories    │                                       │ selected field       │
│      │ schema resources   │ table / asset grid / schema graph     │ permission details   │
│      │ roles / settings   │                                       │                      │
└──────┴────────────────────┴───────────────────────────────────────┴──────────────────────┘
```

The layout is intended to keep context visible, reduce repeated headings and nested panels, and make the Studio recognizable at a glance.

## Design principles

### Workbench first

Routine screens should prioritize the actual work surface. Large dashboard-style titles, repeated descriptions and stacked cards should not push content below the fold.

### Context stays visible

Moving between records, fields, roles and files should not require repeatedly rebuilding mental context. Quick inspection and contextual navigation should be available without replacing the entire page whenever possible.

### Dense without becoming cramped

Tables and schema lists should make better use of desktop space while keeping clear focus, readable typography and comfortable touch targets. Density preferences should remain available for users who prefer more spacing.

### Motion explains state

Animation should communicate navigation, selection, saving, uploading, filtering or structural change. Decorative motion, continuous glow effects and unnecessary transitions do not belong in routine work surfaces.

### One visual system

Light mode, dark mode, appearance customization, responsive layouts, dialogs, tables, inspectors and forms should use the same semantic design tokens rather than feature-specific color patches.

## Content workbench

Content is the primary Studio workspace and will receive the largest usability improvement.

Planned behavior:

- compact collection header with record count and primary action;
- integrated search, filters, sorting, columns and density controls;
- filters shown in a popover or sheet instead of a permanently expanded form;
- sticky table header;
- optional row selection and bulk actions;
- relation values displayed as readable related-record labels when available;
- file and image fields displayed with useful previews;
- clear boolean, status and empty values;
- quick record inspection from the table;
- full record routes remain available for deep links and larger forms;
- responsive record cards remain available on narrow screens.

Example desktop direction:

```text
┌───────────────────┬──────────────────────────────────────────────────────────────┐
│ CONTENT           │ Products                                      + New Record │
│ Search…           │ 124 records                                                │
│                   │                                                            │
│ ▾ Commerce        │ [All records ▾] [Search…] [Filter 2] [Sort] [Columns]     │
│   ● Products      ├────────────────────────────────────────────────────────────┤
│     Categories    │ □ Product            Category       Price    Active     ⋯  │
│     Orders        │ □ Cloud Keyboard     Hardware       $89      Yes        ⋯  │
│                   │ □ Studio Mouse       Hardware       $49      Yes        ⋯  │
│ ▾ Editorial       │ □ Dock               Accessory      $65      No         ⋯  │
│     Posts         │                                                            │
│                   │ 1–25 of 124                              ‹ 1 2 3 4 5 ›     │
└───────────────────┴──────────────────────────────────────────────────────────────┘
```

## Record inspector

A row can open a compact inspector without leaving the list.

```text
┌ Product ──────────────────────┐
│ Cloud Keyboard          Open ×│
│                               │
│ Name                          │
│ [ Cloud Keyboard            ] │
│                               │
│ Category                      │
│ [ Hardware                 ▾] │
│                               │
│ Price                         │
│ [ 89                        ] │
│                               │
│             Cancel     Save   │
└───────────────────────────────┘
```

The inspector is for fast edits. The full record page remains the complete editing surface.

## Data Model workbench

Data Model should become one of the most distinctive parts of YunCMS Studio.

### Fields view

Fields should use meaningful type icons and compact metadata instead of placeholder-style type letters.

```text
Products / products                         Fields | Graph      + Field

FIELD             TYPE             FLAGS
─────────────────────────────────────────────────────────────
id                UUID             Primary · Readonly
name              Text             Required
category_id       Relation         → Categories
image             Image            Optional
created_at        DateTime         Managed
```

### Schema graph

A read-only graph will provide an at-a-glance view of collection relationships using the existing schema and relation metadata.

```text
                         ┌──────────────┐
                         │ Categories   │
                         │ id           │
                         │ name         │
                         └──────▲───────┘
                                │ category_id
                                │
┌──────────────┐         ┌──────┴───────┐         ┌──────────────┐
│ Customers    │◀────────│ Orders       │────────▶│ Products     │
│ id           │         │ id           │         │ id           │
│ name         │         │ total        │         │ name         │
└──────────────┘         └──────────────┘         └──────────────┘
```

Selecting a node should highlight its relationships and expose useful schema details. Schema mutation will remain explicit rather than being hidden behind accidental drag gestures.

## Relation creation

Relation setup should show the resulting structure before the user confirms it.

```text
                  customer_id
┌──────────────┐ ───────────────▶ ┌──────────────┐
│    Orders    │                  │  Customers   │
│     MANY     │                  │     ONE      │
└──────────────┘                  └──────────────┘

On delete: RESTRICT
Result: orders.customer_id
```

## Files workbench

Files will behave more like an asset browser and less like a generic form screen.

Planned improvements:

- asset grid remains the default visual focus;
- file categories move into contextual navigation;
- search, type and sorting controls remain close to the results;
- drag-and-drop can activate the whole usable workspace as a drop target;
- selected assets can open in an inspector;
- media preview remains available for supported formats;
- upload state communicates queued, uploading, completed and failed states without inventing unavailable progress values;
- list view remains available for metadata-heavy workflows.

## Access and permissions

Permissions should expose YunCMS' existing capabilities without requiring every user to reason directly in JSON.

The main role view will use a compact matrix:

```text
Editor             READ       CREATE      UPDATE      DELETE
──────────────────────────────────────────────────────────────
Products             ✓           ✓           ◐           —
Orders               ✓           —           ◐           —
Customers            ✓           ✓           ✓           —
Files                ✓           ✓           —           —
```

States:

- `✓` full configured access;
- `◐` access with field, filter or validation restrictions;
- `—` no access.

Detailed permission editing will provide visual field selection and rule building while keeping raw JSON available as an advanced option.

## AI workspace

The AI workspace will continue to respect normal YunCMS permissions and access modes. The interface will emphasize the actual operations performed by the assistant rather than decorative AI styling.

Useful operation feedback includes:

```text
✓ Read Products
✓ Updated Products
! Delete operation denied
```

The current read/write/full access boundaries remain visible and explicit.

## Navigation and command palette

The application rail will provide stable access to the main Studio tools.

A command palette is planned for keyboard-first navigation. The initial scope includes:

- opening major Studio tools;
- finding collections by display name or API key;
- starting common actions such as creating a record, file, collection or role;
- switching supported appearance preferences.

Keyboard navigation should work consistently with arrow keys, Enter and Escape.

## Visual system

Studio will move toward semantic design tokens for surfaces, text, borders, focus, selection and state colors.

The existing appearance accent remains useful, but accent color should be reserved for selection, primary actions, focus and active navigation rather than being applied to every badge or card.

Recommended interface scale:

```text
11px  metadata and compact status
12px  machine keys and supporting labels
13px  dense data rows
14px  standard controls and copy
16px  section headings
20px  workspace titles
24–28px exceptional top-level or authentication headings
```

Routine workspaces should not use oversized dashboard headings.

## Motion and feedback

Motion will use short, restrained transitions with reduced-motion support.

Typical ranges:

- micro state changes: about 110 ms;
- selection, menus and inspector movement: about 160 ms;
- larger workspace transitions: about 210 ms.

Examples:

- an inspector enters with a small horizontal movement and fade;
- a saved row receives a brief, non-blocking highlight;
- a permission cell changes state locally instead of reanimating the whole matrix;
- a newly created relation can briefly emphasize its new edge;
- file drag-over clearly changes the workspace into a drop target.

## Responsive behavior

### Desktop

- application rail visible;
- context rail visible when useful;
- workbench uses remaining width;
- inspector appears without covering the main workspace when space allows.

### Tablet

- context rail can collapse into a drawer;
- inspector may overlay the workbench;
- tables retain horizontal scrolling where necessary.

### Mobile

- primary navigation becomes a compact drawer or sheet;
- large tables use record cards where that improves readability;
- filters use full-width sheets;
- inspectors become full-height sheets;
- primary actions remain reachable without hover behavior.

## Accessibility

The redesign should preserve or improve:

- visible keyboard focus;
- semantic buttons and navigation;
- proper labels for icon-only actions;
- `aria-current`, `aria-expanded` and selection states where appropriate;
- touch-accessible controls;
- state communication that does not rely on color alone;
- `prefers-reduced-motion` support.

## Delivery sequence

The redesign is planned in incremental stages so existing Studio behavior stays usable during the transition.

### Foundation

- [ ] unify semantic visual tokens;
- [ ] establish the compact application shell;
- [ ] remove duplicated routine page headings;
- [ ] consolidate common controls and interaction states.

### Content

- [ ] compact content header and toolbar;
- [ ] filter popover or sheet;
- [ ] improved table value rendering;
- [ ] selection and bulk-action foundation;
- [ ] quick record inspector.

### Files

- [ ] contextual file navigation;
- [ ] stronger asset browser layout;
- [ ] workspace drag-and-drop state;
- [ ] file inspector.

### Data Model

- [ ] field type icon system;
- [ ] compact collection and field workspace;
- [ ] schema graph;
- [ ] clearer relation preview and creation flow.

### Access

- [ ] compact role navigation;
- [ ] permission matrix states;
- [ ] visual field and rule editing;
- [ ] advanced raw JSON view.

### Navigation and polish

- [ ] command palette;
- [ ] unified motion feedback;
- [ ] responsive and reduced-motion pass;
- [ ] public Studio documentation refresh;
- [ ] updated screenshots for the README and documentation.

## Compatibility

Studio Next is an interface redesign. Existing YunCMS REST routes, collection data, authentication providers, permissions, Files storage, extensions, AI permission boundaries and MCP behavior should continue to work unless a separately documented product change explicitly says otherwise.

The public documentation will describe shipped behavior as each part of the redesign becomes available.