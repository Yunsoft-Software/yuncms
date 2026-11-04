// SPDX-FileCopyrightText: 2026 Yunsoft Software
// SPDX-License-Identifier: LicenseRef-YunCMS-Commercial
export const CONTENT_HISTORY_PAGE_SIZE = 25;

export function contentHistoryPage(rows) {
  return { rows: rows.slice(0, CONTENT_HISTORY_PAGE_SIZE), hasNext: rows.length > CONTENT_HISTORY_PAGE_SIZE };
}
