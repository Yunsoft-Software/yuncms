import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkIfRange,
  evaluateRangeRequest,
  parseByteRange,
} from '../src/byte-range.js';

test('parseByteRange handles full, first, last, open, suffix, clamped, huge numbers, zero-size, invalid, multi, and 416', () => {
  const size = 100;

  // full (no range header or empty)
  assert.deepEqual(parseByteRange(null, size), { type: 'none' });
  assert.deepEqual(parseByteRange(undefined, size), { type: 'none' });
  assert.deepEqual(parseByteRange('', size), { type: 'none' });

  // first byte
  assert.deepEqual(parseByteRange('bytes=0-0', size), {
    type: 'range',
    start: 0,
    end: 0,
    length: 1,
    size: 100,
  });

  // last byte
  assert.deepEqual(parseByteRange('bytes=99-99', size), {
    type: 'range',
    start: 99,
    end: 99,
    length: 1,
    size: 100,
  });
  assert.deepEqual(parseByteRange('bytes=-1', size), {
    type: 'range',
    start: 99,
    end: 99,
    length: 1,
    size: 100,
  });

  // open-ended
  assert.deepEqual(parseByteRange('bytes=50-', size), {
    type: 'range',
    start: 50,
    end: 99,
    length: 50,
    size: 100,
  });

  // suffix
  assert.deepEqual(parseByteRange('bytes=-20', size), {
    type: 'range',
    start: 80,
    end: 99,
    length: 20,
    size: 100,
  });

  // clamped (end clamped to size - 1)
  assert.deepEqual(parseByteRange('bytes=50-200', size), {
    type: 'range',
    start: 50,
    end: 99,
    length: 50,
    size: 100,
  });

  // clamped suffix (larger than size clamps start to 0)
  assert.deepEqual(parseByteRange('bytes=-200', size), {
    type: 'range',
    start: 0,
    end: 99,
    length: 100,
    size: 100,
  });

  // huge numbers
  assert.deepEqual(parseByteRange('bytes=99999999999999999999999-', size), {
    type: 'unsatisfiable',
    size: 100,
  });
  assert.deepEqual(parseByteRange('bytes=0-99999999999999999999999', size), {
    type: 'range',
    start: 0,
    end: 99,
    length: 100,
    size: 100,
  });

  // zero-size representation (any range is unsatisfiable)
  assert.deepEqual(parseByteRange('bytes=0-0', 0), {
    type: 'unsatisfiable',
    size: 0,
  });
  assert.deepEqual(parseByteRange('bytes=0-', 0), {
    type: 'unsatisfiable',
    size: 0,
  });
  assert.deepEqual(parseByteRange('bytes=-1', 0), {
    type: 'unsatisfiable',
    size: 0,
  });

  // invalid / malformed formats (ignored per RFC and yields full response)
  assert.deepEqual(parseByteRange('bytes=abc', size), { type: 'malformed' });
  assert.deepEqual(parseByteRange('bytes=-', size), { type: 'malformed' });
  assert.deepEqual(parseByteRange('bytes=--5', size), { type: 'malformed' });
  assert.deepEqual(parseByteRange('bytes=50-20', size), { type: 'malformed' }); // start > end
  assert.deepEqual(parseByteRange('items=0-10', size), { type: 'malformed' }); // unknown unit
  assert.deepEqual(parseByteRange('characters=0-10', size), { type: 'malformed' });

  // multi-range (ignored in YunCMS V1)
  assert.deepEqual(parseByteRange('bytes=0-10,20-30', size), { type: 'multi' });

  // 416 unsatisfiable ranges
  assert.deepEqual(parseByteRange('bytes=100-150', size), {
    type: 'unsatisfiable',
    size: 100,
  });
  assert.deepEqual(parseByteRange('bytes=100-', size), {
    type: 'unsatisfiable',
    size: 100,
  });
  assert.deepEqual(parseByteRange('bytes=-0', size), {
    type: 'unsatisfiable',
    size: 100,
  });
});

test('checkIfRange enforces strong ETag exact match and rejects weak ETags', () => {
  const etag = '"file-1-64-6707a000"';
  const modifiedAt = new Date('2026-10-10T12:00:00.000Z');

  // No If-Range header allows range
  assert.equal(checkIfRange(null, etag, modifiedAt), true);
  assert.equal(checkIfRange('', etag, modifiedAt), true);

  // Strong ETag exact match allows range
  assert.equal(checkIfRange('"file-1-64-6707a000"', etag, modifiedAt), true);

  // Strong ETag mismatch rejects range
  assert.equal(checkIfRange('"file-1-64-other"', etag, modifiedAt), false);

  // Weak ETag MUST NOT be used for subrange (RFC 9110 section 13.1.5)
  assert.equal(checkIfRange('W/"file-1-64-6707a000"', etag, modifiedAt), false);
  assert.equal(checkIfRange('w/"file-1-64-6707a000"', etag, modifiedAt), false);
});

test('checkIfRange enforces exact Last-Modified second match and rejects mismatched dates', () => {
  const etag = '"file-1-64-6707a000"';
  const modifiedAt = new Date('2026-10-10T12:00:00.000Z');

  // Exact second match allows range
  assert.equal(
    checkIfRange('Sat, 10 Oct 2026 12:00:00 GMT', etag, modifiedAt),
    true,
  );

  // One second earlier rejects range (exact match, not <=)
  assert.equal(
    checkIfRange('Sat, 10 Oct 2026 11:59:59 GMT', etag, modifiedAt),
    false,
  );

  // One second later rejects range
  assert.equal(
    checkIfRange('Sat, 10 Oct 2026 12:00:01 GMT', etag, modifiedAt),
    false,
  );

  // Invalid date string rejects range
  assert.equal(checkIfRange('not-a-valid-date', etag, modifiedAt), false);

  // Non-HTTP dates (ISO strings, numeric timestamps, date garbage) reject range even if Date.parse accepts them
  assert.equal(checkIfRange('2026-10-10T12:00:00.000Z', etag, modifiedAt), false);
  assert.equal(checkIfRange('1760100000', etag, modifiedAt), false);
  assert.equal(checkIfRange('2026-10-10', etag, modifiedAt), false);

  // Missing representation modifiedAt rejects date comparison
  assert.equal(checkIfRange('Sat, 10 Oct 2026 12:00:00 GMT', etag, null), false);
});

test('evaluateRangeRequest produces correct HTTP status, lengths, and headers', () => {
  const size = 100;
  const etag = '"file-1-64-6707a000"';
  const modifiedAt = new Date('2026-10-10T12:00:00.000Z');

  // Valid 206 range
  const partial = evaluateRangeRequest({
    rangeHeader: 'bytes=10-29',
    ifRangeHeader: null,
    size,
    etag,
    modifiedAt,
  });
  assert.equal(partial.status, 206);
  assert.equal(partial.start, 10);
  assert.equal(partial.end, 29);
  assert.equal(partial.contentLength, 20);
  assert.equal(partial.contentRange, 'bytes 10-29/100');

  // Unsatisfiable 416 range
  const unsatisfiable = evaluateRangeRequest({
    rangeHeader: 'bytes=200-300',
    ifRangeHeader: null,
    size,
    etag,
    modifiedAt,
  });
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.contentLength, 0);
  assert.equal(unsatisfiable.contentRange, 'bytes */100');

  // Malformed range falls back to full 200
  const malformed = evaluateRangeRequest({
    rangeHeader: 'bytes=malformed',
    ifRangeHeader: null,
    size,
    etag,
    modifiedAt,
  });
  assert.equal(malformed.status, 200);
  assert.equal(malformed.contentLength, 100);

  // If-Range mismatch falls back to full 200
  const ifRangeMismatch = evaluateRangeRequest({
    rangeHeader: 'bytes=10-20',
    ifRangeHeader: 'W/"weak"',
    size,
    etag,
    modifiedAt,
  });
  assert.equal(ifRangeMismatch.status, 200);
  assert.equal(ifRangeMismatch.contentLength, 100);

  // If-Range exact match processes 206
  const ifRangeMatch = evaluateRangeRequest({
    rangeHeader: 'bytes=10-20',
    ifRangeHeader: etag,
    size,
    etag,
    modifiedAt,
  });
  assert.equal(ifRangeMatch.status, 206);
  assert.equal(ifRangeMatch.contentLength, 11);
  assert.equal(ifRangeMatch.contentRange, 'bytes 10-20/100');
});
