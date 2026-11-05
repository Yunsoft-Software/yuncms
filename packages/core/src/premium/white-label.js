// SPDX-FileCopyrightText: 2026 Yunsoft Software
// SPDX-License-Identifier: LicenseRef-YunCMS-Commercial

export const OFFICIAL_STUDIO_BRANDING = Object.freeze({
  brand_name: 'YunCMS', logo_url: 'https://yunsoft.com/light-logo.png',
  logo_file: null, favicon_file: null,
});

export function effectiveStudioBranding(row, { enabled = false, available = false, premium = false } = {}) {
  const active = enabled === true && available === true && premium === true;
  return {
    ...(active ? {
      brand_name: !row.brand_name || row.brand_name === 'YunCMS' ? 'Studio' : row.brand_name,
      logo_url: null, logo_file: row.logo_file ?? null, favicon_file: row.favicon_file ?? null,
    } : OFFICIAL_STUDIO_BRANDING),
    white_label_enabled: active, white_label_available: available === true, premium: premium === true,
  };
}
