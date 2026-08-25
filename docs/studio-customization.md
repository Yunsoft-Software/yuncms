# Studio Customization

YunCMS keeps Studio customization focused: enough branding and presentation control to make the product yours without turning the CMS itself into a page builder.

## Stored settings

`yuncms_studio_settings` is a single-row system table.

Relevant migrations:

- `0006-studio-settings` — brand name, logo URL fallback, accent, theme and locale;
- `0008-studio-logo-file` — optional Files-backed logo;
- `0010-studio-favicon-file` — optional Files-backed favicon.

The administrator can change:

- brand name;
- logo selected from YunCMS Files;
- favicon selected from YunCMS Files;
- accent color;
- theme: `system`, `light` or `dark`;
- default locale: `en` or `tr`.

`GET /studio-settings` is intentionally public because login/reset/verification surfaces need safe display settings before authentication. It exposes only display settings. `PATCH /studio-settings` is administrator/system-only through `StudioSettingsService`.

---

# Logo and favicon selection

Studio does not ask the administrator to paste arbitrary external URLs.

Branding & Appearance shows a compact current-asset summary. Clicking **Select from Files** opens a modal that:

- reads the existing YunCMS file library;
- filters to image MIME types;
- supports search;
- renders a paginated 12-item grid instead of dumping every image into the settings page;
- previews each candidate;
- saves only the selected Files id.

This keeps a project with 5 images and a project with 500 images usable through the same interaction model.

Stored references:

```text
logo_file    -> yuncms_files.id
favicon_file -> yuncms_files.id
```

Both foreign keys are nullable and use `ON DELETE SET NULL`. Deleting the selected branding file therefore returns Studio to the built-in fallback instead of leaving a broken id in settings.

Only image MIME types are accepted by `StudioSettingsService`; a raw API client cannot bypass the Studio image picker and configure a PDF/video as the logo or favicon.

---

# Public branding asset endpoints

The Files library keeps its normal authentication/RBAC behavior. YunCMS does **not** make `/files/:id/content` public for branding.

Instead it exposes only the currently configured branding images:

```text
GET /studio-settings/logo
GET /studio-settings/favicon
```

The service first reads the single selected file id from Studio settings, validates that the referenced file still exists and is an image, then reads its bytes from the configured storage driver.

Responses use revalidation and a sandbox Content-Security-Policy so an SVG branding asset cannot become a general same-origin active document surface.

These endpoints are useful before login, including the login/reset/verification UI and the browser favicon.

---

# Default Yunsoft branding

Built-in logo artwork:

```text
https://yunsoft.com/light-logo.png
https://yunsoft.com/dark-logo.png
```

The asset name describes the artwork, not the surface it belongs on:

- Dark Studio surface → `light-logo.png`.
- Light Studio surface → `dark-logo.png`.
- System theme → resolved OS/browser theme, using the same contrast rule.

Default favicon/icon:

```text
https://yunsoft.com/light-icon.png
```

The default icon is available immediately during page load. When Studio settings load and `favicon_file` is configured, Studio switches to the Files-backed `/studio-settings/favicon` asset.

A custom Files-backed logo replaces the Yunsoft logo artwork. The small `Powered by Yunsoft` / copyright footer is independent and remains visible.

---

# Brand name

`brand_name` is human-facing copy used for accessibility/fallback presentation. It does not change collection keys, API URLs or database schema identifiers.

The Data Model follows the same overall principle for collection/field labels: human-facing names and stable machine identifiers are separate concerns. See [`rest-api.md`](rest-api.md) and [`api-query-language.md`](api-query-language.md).

---

# Accent and theme

The accent is a validated six-digit hex color. Studio maps it to shared CSS variables used for primary actions, active navigation, focus states and lightweight badges.

Theme values:

- `light`: always light;
- `dark`: always dark;
- `system`: follows the browser/OS `prefers-color-scheme` value and listens for changes while Studio is open.

Pagination, permission matrices, permission-rule badges, Files surfaces, dialogs and Data Model panels should use Studio variables instead of hard-coded white backgrounds.

---

# Localization

Studio ships English and Turkish dictionaries plus focused current-UI modules.

Language resolution:

```text
personal browser preference -> server default_locale -> English fallback
```

The personal preference is stored in browser local storage. Changing it does not alter the project-wide default for other users.

English and Turkish cover the same Studio interface. Dynamic field, action and Data Model labels follow the active personal language where translations are available.

---

# Architecture

```text
0006 Studio settings
  + 0008 logo_file FK
  + 0010 favicon_file FK
       │
       ▼
StudioSettingsService
       │
       ├─ GET/PATCH /studio-settings
       ├─ GET /studio-settings/logo
       └─ GET /studio-settings/favicon
       │
       ▼
StudioSettingsProvider
       │
       ├─ theme / accent / locale
       ├─ runtime favicon
       └─ branding state
       │
       ▼
BrandAssetPicker
       └─ FilePickerModal
            ├─ image filter
            ├─ search
            ├─ pagination
            └─ FilePreview
```

Screens never read the database directly. Authenticated asset selection uses the Files API; pre-auth rendering uses only the two bounded public branding endpoints.
