// SPDX-FileCopyrightText: 2026 Yunsoft Software
// SPDX-License-Identifier: MIT

function formatUtcDate(iso, locale) {
  if (typeof iso !== 'string' || !iso) return null;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale || 'en', { dateStyle: 'medium', timeZone: 'UTC' }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

export function formatLicenseSummary(license, { locale = 'en', t } = {}) {
  if (!license || typeof t !== 'function') return '';
  if (!['active', 'expired'].includes(license.status) || !license.domain) {
    if (license.configuredDomain) {
      return t('features.summaryReadyDomain', { domain: license.configuredDomain });
    }
    if (license.status === 'missing' || license.status === 'invalid') {
      return t('features.summaryMissingDomain');
    }
    return '';
  }
  const plan = license.billingModel === 'one_time_perpetual'
    ? t('features.planPerpetual')
    : license.periodMonths === 1
      ? t('features.planMonthly')
      : license.periodMonths === 12
        ? t('features.planAnnual')
        : Number.isSafeInteger(license.periodMonths) && license.periodMonths > 1
          ? t('features.planMonths', { months: license.periodMonths })
          : t('features.planTerm');
  const date = formatUtcDate(license.expiresAt, locale);
  if (license.status === 'expired' && date) {
    return t('features.summaryExpired', { domain: license.domain, plan, date });
  }
  if (date) {
    return t('features.summaryActiveTerm', { domain: license.domain, plan, date });
  }
  return t('features.summaryPerpetual', { domain: license.domain, plan });
}
