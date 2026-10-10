/**
 * Pure HTTP byte-range helper compliant with RFC 9110 Sections 13.1.5 and 14.1.2.
 * @see https://www.rfc-editor.org/rfc/rfc9110.html#name-if-range
 */

export function parseByteRange(rangeHeader, size) {
  if (rangeHeader == null || rangeHeader === '') {
    return { type: 'none' };
  }

  if (typeof rangeHeader !== 'string') {
    return { type: 'malformed' };
  }

  const trimmed = rangeHeader.trim();
  if (!trimmed.startsWith('bytes=')) {
    return { type: 'malformed' };
  }

  const spec = trimmed.slice(6).trim();
  if (!spec) {
    return { type: 'malformed' };
  }

  // Multi-range is ignored according to YunCMS specification
  if (spec.includes(',')) {
    return { type: 'multi' };
  }

  const match = spec.match(/^(?:(\d+)-(\d*)|-(\d+))$/);
  if (!match) {
    return { type: 'malformed' };
  }

  const safeSize = Number(size);

  if (match[1] !== undefined) {
    const startStr = match[1];
    const endStr = match[2];

    if (endStr !== '') {
      // Form: start-end
      // Guard against huge numbers exceeding MAX_SAFE_INTEGER
      if (startStr.length > 16 || Number(startStr) > Number.MAX_SAFE_INTEGER) {
        return { type: 'unsatisfiable', size: safeSize };
      }

      const start = Number(startStr);
      let end;
      if (endStr.length > 16 || Number(endStr) > Number.MAX_SAFE_INTEGER) {
        end = safeSize > 0 ? safeSize - 1 : 0;
      } else {
        end = Number(endStr);
      }

      // RFC 9110 14.1.2: invalid if last-byte-pos is less than first-byte-pos
      if (start > end) {
        return { type: 'malformed' };
      }

      if (safeSize === 0 || start >= safeSize) {
        return { type: 'unsatisfiable', size: safeSize };
      }

      const clampedEnd = Math.min(end, safeSize - 1);
      return {
        type: 'range',
        start,
        end: clampedEnd,
        length: clampedEnd - start + 1,
        size: safeSize,
      };
    }

    // Form: start- (open-ended)
    if (startStr.length > 16 || Number(startStr) > Number.MAX_SAFE_INTEGER) {
      return { type: 'unsatisfiable', size: safeSize };
    }

    const start = Number(startStr);
    if (safeSize === 0 || start >= safeSize) {
      return { type: 'unsatisfiable', size: safeSize };
    }

    const end = safeSize - 1;
    return {
      type: 'range',
      start,
      end,
      length: end - start + 1,
      size: safeSize,
    };
  }

  // Form: -suffix
  const suffixStr = match[3];
  if (suffixStr.length > 16 || Number(suffixStr) > Number.MAX_SAFE_INTEGER) {
    if (safeSize === 0) return { type: 'unsatisfiable', size: safeSize };
    return {
      type: 'range',
      start: 0,
      end: safeSize - 1,
      length: safeSize,
      size: safeSize,
    };
  }

  const suffix = Number(suffixStr);
  if (suffix === 0 || safeSize === 0) {
    return { type: 'unsatisfiable', size: safeSize };
  }

  const start = Math.max(0, safeSize - suffix);
  const end = safeSize - 1;
  return {
    type: 'range',
    start,
    end,
    length: end - start + 1,
    size: safeSize,
  };
}

const HTTP_DATE_REGEX = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: \d|\d{2}) \d{2}:\d{2}:\d{2} \d{4})$/;

export function checkIfRange(ifRangeHeader, etag, modifiedAt) {
  if (ifRangeHeader == null || ifRangeHeader === '') {
    return true;
  }

  if (typeof ifRangeHeader !== 'string') {
    return false;
  }

  const token = ifRangeHeader.trim();
  // RFC 9110 section 13.1.5: weak entity tags MUST NOT be used for subrange requests
  if (token.startsWith('W/') || token.startsWith('w/')) {
    return false;
  }

  // Strong entity tag
  if (token.startsWith('"')) {
    return token === etag;
  }

  // HTTP-date validator: exact second match per RFC 9110 section 13.1.5 (not <=)
  // Non-HTTP dates (ISO strings, numeric timestamps, date garbage) are rejected per RFC 9110 section 5.6.7
  if (!modifiedAt || !HTTP_DATE_REGEX.test(token)) {
    return false;
  }

  const parsed = Date.parse(token);
  if (Number.isNaN(parsed)) {
    return false;
  }

  const modDate = modifiedAt instanceof Date ? modifiedAt : new Date(modifiedAt);
  if (Number.isNaN(modDate.getTime())) {
    return false;
  }

  return Math.floor(parsed / 1000) === Math.floor(modDate.getTime() / 1000);
}

export function evaluateRangeRequest({
  rangeHeader,
  ifRangeHeader,
  size,
  etag,
  modifiedAt,
}) {
  const safeSize = Number(size);

  if (ifRangeHeader && !checkIfRange(ifRangeHeader, etag, modifiedAt)) {
    return {
      status: 200,
      contentLength: safeSize,
    };
  }

  const parsed = parseByteRange(rangeHeader, safeSize);
  if (parsed.type === 'range') {
    return {
      status: 206,
      start: parsed.start,
      end: parsed.end,
      contentLength: parsed.length,
      contentRange: `bytes ${parsed.start}-${parsed.end}/${safeSize}`,
    };
  }

  if (parsed.type === 'unsatisfiable') {
    return {
      status: 416,
      contentLength: 0,
      contentRange: `bytes */${safeSize}`,
    };
  }

  return {
    status: 200,
    contentLength: safeSize,
  };
}
