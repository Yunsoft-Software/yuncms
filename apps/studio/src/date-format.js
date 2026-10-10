const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

export function parseCalendarDate(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = value.getUTCMonth() + 1;
    const day = value.getUTCDate();
    const date = new Date(Date.UTC(year, month - 1, day));
    return {
      date,
      isoDate: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    };
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();

  const dateMatch = CALENDAR_DATE_PATTERN.exec(trimmed);
  if (dateMatch) {
    const year = Number.parseInt(dateMatch[1], 10);
    const month = Number.parseInt(dateMatch[2], 10);
    const day = Number.parseInt(dateMatch[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
    ) {
      return null;
    }

    return { date, isoDate: trimmed };
  }

  const isoMatch = ISO_INSTANT_PATTERN.exec(trimmed);
  if (isoMatch) {
    const instant = new Date(trimmed);
    if (Number.isNaN(instant.getTime())) return null;

    const year = Number.parseInt(isoMatch[1], 10);
    const month = Number.parseInt(isoMatch[2], 10);
    const day = Number.parseInt(isoMatch[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
    ) {
      return null;
    }

    return { date, isoDate: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}` };
  }

  return null;
}

export function formatCalendarDate(value, locale = 'en') {
  const parsed = parseCalendarDate(value);
  if (!parsed) return null;
  const intlLocale = locale === 'tr' ? 'tr-TR' : 'en-US';
  const formatter = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
  return {
    formatted: formatter.format(parsed.date),
    dateTime: parsed.isoDate,
  };
}

export function formatInstant(value, locale = 'en') {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const intlLocale = locale === 'tr' ? 'tr-TR' : 'en-US';
  const formatter = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return {
    formatted: formatter.format(date),
    dateTime: date.toISOString(),
  };
}

export function formatDateFieldValue(type, value, locale = 'en') {
  if (type === 'date') {
    return formatCalendarDate(value, locale);
  }
  if (type === 'datetime' || type === 'timestamp') {
    return formatInstant(value, locale);
  }
  return null;
}
