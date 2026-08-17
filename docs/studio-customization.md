# Studio Customization

YunCMS keeps Studio customization intentionally small. It is not a template builder or a second design system.

## Stored settings

`yuncms_studio_settings` is a single-row system table created by migration `0006-studio-settings`.

The administrator can change:

- brand name;
- logo URL;
- accent color;
- theme: `system`, `light` or `dark`;
- default locale: `en` or `tr`.

`GET /studio-settings` is intentionally public because login/reset/verification screens need safe display settings before authentication. It exposes only the display settings above. `PATCH /studio-settings` is administrator/system-only through `StudioSettingsService`.

## Default Yunsoft branding

The default logo is the official Yunsoft website logo:

```text
https://yunsoft.com/light-logo.png
```

The default brand name remains `YunCMS` so the product identity is clear while the logo carries the Yunsoft company brand.

If an administrator saves a custom logo URL, that single configured logo replaces the Yunsoft logo everywhere in Studio. YunCMS does not render the default Yunsoft logo next to or behind a custom logo.

The small `Powered by Yunsoft` / copyright footer is separate from the configurable logo and remains visible when a custom logo is used.

If the configured logo cannot be loaded, Studio falls back to the configured brand text instead of inserting a second Yunsoft logo.

## Accent and theme

The accent is a validated six-digit hex color. Studio maps it to shared CSS variables used for primary actions, active navigation, focus states and lightweight badges.

Theme values:

- `light`: always light;
- `dark`: always dark;
- `system`: follows the browser/OS `prefers-color-scheme` value and listens for changes while Studio is open.

The implementation stays in `appearance.css` and CSS custom properties rather than duplicating component trees for each theme.

## Localization

Studio ships English and Turkish dictionaries:

```text
apps/studio/src/locales/en.js
apps/studio/src/locales/tr.js
```

Pure translation functions live in `localization.js`. The small React hook in `i18n.js` only connects those functions to `StudioSettingsContext`.

Language resolution is:

```text
personal browser preference -> server default_locale -> English fallback
```

The personal preference is intentionally stored in browser local storage. Changing it does not change the project-wide default for other users.

Static translation keys used by Studio source are scanned by `apps/studio/test/localization.test.js`; both locale dictionaries must contain the same key set.

## Architecture

```text
0006 migration
  -> StudioSettingsService
  -> GET/PATCH /studio-settings
  -> StudioSettingsProvider
  -> useI18n / localization dictionaries
  -> StudioBrand / AppearanceScreen / existing Studio screens
```

Screens do not read the database, local storage or theme media query directly. Those concerns stay behind the service/context/helper boundaries.
