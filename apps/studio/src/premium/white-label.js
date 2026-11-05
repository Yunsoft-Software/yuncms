// SPDX-FileCopyrightText: 2026 Yunsoft Software
// SPDX-License-Identifier: LicenseRef-YunCMS-Commercial

export function brandStudioMessage(message, settings) {
  if (settings?.white_label_enabled !== true) return message;
  const brand = String(settings.brand_name || 'Studio');
  return message.replace(/yuncms|yunsoft/gi, () => brand);
}
