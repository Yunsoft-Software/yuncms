# Studio Customization

YunCMS keeps Studio customization intentionally small. It is not a template builder or a second design system.

## Stored settings

`yuncms_studio_settings` is a single-row system table created by migration `0006-studio-settings`. Migration `0008-studio-logo-file` adds the optional Files-backed logo reference.

The administrator can change:

- brand name;
- logo selected from existing YunCMS Files;
- accent color;
- theme: `system`, `light` or `dark`;
- default locale: `en` or `tr`.

`GET /studio-settings` is intentionally public because login/reset/verification screens need safe display settings before authentication. It exposes only display settings. `PATCH /studio-settings` is administrator/system-only through `StudioSettingsService`.

Studio no longer exposes an arbitrary Logo URL field. A custom logo is selected from image files already managed by YunCMS. The selected file id is stored in `logo_file`, which is a nullable FK to `yuncms_files(id)` with `ON DELETE SET NULL`.

## Public branding asset

Files themselves keep their normal authentication/RBAC rules. YunCMS does **not** make the Files library public to support the login logo.

Instead, when `logo_file` is configured, the narrow public endpoint:

```text
GET /studio-settings/logo
```

reads only the one configured file and only when its MIME type is an image. This lets pre-login Studio screens render branding without exposing arbitrary file ids.

## Default Yunsoft branding

YunCMS keeps the official Yunsoft artwork URLs as built-in fallback assets:

```text
https://yunsoft.com/light-logo.png
https://yunsoft.com/dark-logo.png
```

The asset names describe the artwork itself. To maintain contrast:

- Dark Studio surfaces use `light-logo.png`.
- Light Studio surfaces use `dark-logo.png`.
- System theme follows the resolved OS/browser theme using the same contrast rule.

The default brand name remains `YunCMS`. A selected Files-backed custom logo replaces the Yunsoft artwork everywhere in Studio. The small `Powered by Yunsoft` / copyright footer is independent and remains visible.

If no custom logo is selected, or a selected logo file is deleted and the FK becomes `NULL`, Studio returns to the default Yunsoft artwork behavior.

## Accent and theme

The accent is a validated six-digit hex color. Studio maps it to shared CSS variables used for primary actions, active navigation, focus states and lightweight badges.

Theme values:

- `light`: always light;
- `dark`: always dark;
- `system`: follows the browser/OS `prefers-color-scheme` value and listens for changes while Studio is open.

Dark/light surfaces, including pagination and permission matrices, are expected to use Studio CSS variables rather than hard-coded white backgrounds.

## Localization

Studio ships English and Turkish dictionaries plus focused current-UI additions. Pure translation functions live in `localization.js`; the React hook in `i18n.js` connects them to `StudioSettingsContext`.

Language resolution is:

```text
personal browser preference -> server default_locale -> English fallback
```

The personal preference is stored in browser local storage. Changing it does not change the project-wide default for other users.

Static translation keys used by Studio source are scanned by `apps/studio/test/localization.test.js`; both locale dictionaries must contain the same key set. Dynamic field/action/Data Model tab keys are covered explicitly.

## Current architecture

```text
0006 Studio settings
  + 0008 logo_file FK
  -> StudioSettingsService
  -> GET/PATCH /studio-settings
  -> GET /studio-settings/logo
  -> StudioSettingsProvider
  -> LogoFilePicker / StudioBrand / AppearanceScreen
  -> useI18n / localization dictionaries
```

Screens do not read the database directly. File selection uses the normal Files API for authenticated administrators; the saved branding asset uses the bounded public endpoint above.
