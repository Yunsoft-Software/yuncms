import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  formatCalendarDate,
  formatDateFieldValue,
  formatInstant,
  parseCalendarDate,
} from '../src/date-format.js';

const HELPER_URL = new URL('../src/date-format.js', import.meta.url).href;

function runInTimezone(tz, code) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', code],
      {
        env: { ...process.env, TZ: tz },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(`Worker exited with code ${exitCode}: ${stderr}`));
      } else {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (err) {
          reject(new Error(`Failed to parse worker stdout: ${stdout} (${err.message})`));
        }
      }
    });
    child.on('error', reject);
  });
}

test('parseCalendarDate validates calendar day via UTC construction and round-trip', () => {
  const valid = parseCalendarDate('2026-10-10');
  assert.ok(valid);
  assert.equal(valid.isoDate, '2026-10-10');
  assert.equal(valid.date.getUTCFullYear(), 2026);
  assert.equal(valid.date.getUTCMonth(), 9);
  assert.equal(valid.date.getUTCDate(), 10);

  // Leap day in leap year
  const leapValid = parseCalendarDate('2024-02-29');
  assert.ok(leapValid);
  assert.equal(leapValid.isoDate, '2024-02-29');
  assert.equal(leapValid.date.getUTCDate(), 29);

  // Century leap year
  const centuryLeap = parseCalendarDate('2000-02-29');
  assert.ok(centuryLeap);
  assert.equal(centuryLeap.isoDate, '2000-02-29');

  // Legacy ISO format support
  const legacyIso = parseCalendarDate('2026-10-10T00:00:00.000Z');
  assert.ok(legacyIso);
  assert.equal(legacyIso.isoDate, '2026-10-10');

  // Date instance support
  const fromDate = parseCalendarDate(new Date(Date.UTC(2026, 9, 10)));
  assert.ok(fromDate);
  assert.equal(fromDate.isoDate, '2026-10-10');
});

test('parseCalendarDate rejects invalid calendar days, non-leap days, and malformed inputs', () => {
  // Non-leap year Feb 29
  assert.equal(parseCalendarDate('2026-02-29'), null);
  // Century non-leap year Feb 29
  assert.equal(parseCalendarDate('1900-02-29'), null);
  // Months with 30 days
  assert.equal(parseCalendarDate('2026-04-31'), null);
  assert.equal(parseCalendarDate('2026-06-31'), null);
  assert.equal(parseCalendarDate('2026-09-31'), null);
  assert.equal(parseCalendarDate('2026-11-31'), null);
  // Out of range month/day
  assert.equal(parseCalendarDate('2026-00-10'), null);
  assert.equal(parseCalendarDate('2026-13-10'), null);
  assert.equal(parseCalendarDate('2026-10-00'), null);
  assert.equal(parseCalendarDate('2026-10-32'), null);
  // Malformed and empty inputs
  assert.equal(parseCalendarDate(''), null);
  assert.equal(parseCalendarDate(null), null);
  assert.equal(parseCalendarDate(undefined), null);
  assert.equal(parseCalendarDate('not-a-date'), null);
  assert.equal(parseCalendarDate('2026-10'), null);
  assert.equal(parseCalendarDate('2026-10-10Tgarbage'), null);
  assert.equal(parseCalendarDate('2026-10-10 trailing'), null);
  assert.equal(parseCalendarDate('2026-10-10-extra'), null);
  assert.equal(parseCalendarDate(12345), null);
  assert.equal(parseCalendarDate(true), null);
  assert.equal(parseCalendarDate({}), null);
});

test('formatCalendarDate produces localized formatting and preserves YYYY-MM-DD dateTime', () => {
  const en = formatCalendarDate('2026-10-10', 'en');
  assert.equal(en.formatted, 'Oct 10, 2026');
  assert.equal(en.dateTime, '2026-10-10');

  const tr = formatCalendarDate('2026-10-10', 'tr');
  assert.equal(tr.formatted, '10 Eki 2026');
  assert.equal(tr.dateTime, '2026-10-10');

  const leap = formatCalendarDate('2024-02-29', 'en');
  assert.equal(leap.formatted, 'Feb 29, 2024');
  assert.equal(leap.dateTime, '2024-02-29');

  assert.equal(formatCalendarDate('2026-02-29', 'en'), null);
  assert.equal(formatCalendarDate('', 'en'), null);
});

test('formatInstant formats instants and preserves ISO dateTime attribute', () => {
  const instant = formatInstant('2026-10-10T12:00:00.000Z', 'en');
  assert.ok(instant);
  assert.equal(instant.dateTime, '2026-10-10T12:00:00.000Z');
  assert.match(instant.formatted, /2026/);

  assert.equal(formatInstant(null), null);
  assert.equal(formatInstant(''), null);
  assert.equal(formatInstant('invalid-instant'), null);
});

test('formatDateFieldValue delegates by field type', () => {
  const dateResult = formatDateFieldValue('date', '2026-10-10', 'en');
  assert.equal(dateResult.formatted, 'Oct 10, 2026');
  assert.equal(dateResult.dateTime, '2026-10-10');

  const dtResult = formatDateFieldValue('datetime', '2026-10-10T12:00:00.000Z', 'en');
  assert.ok(dtResult);
  assert.equal(dtResult.dateTime, '2026-10-10T12:00:00.000Z');

  const tsResult = formatDateFieldValue('timestamp', '2026-10-10T12:00:00.000Z', 'en');
  assert.ok(tsResult);
  assert.equal(tsResult.dateTime, '2026-10-10T12:00:00.000Z');

  assert.equal(formatDateFieldValue('string', '2026-10-10'), null);
  assert.equal(formatDateFieldValue('date', '2026-02-29'), null);
});

test('America/New_York process preserves October 10 calendar date without shifting to October 9', async () => {
  const script = `
    import { formatCalendarDate, formatDateFieldValue, formatInstant } from '${HELPER_URL}';
    const dateFormatted = formatCalendarDate('2026-10-10', 'en');
    const fieldFormatted = formatDateFieldValue('date', '2026-10-10', 'en');
    const instantFormatted = formatInstant('2026-10-10T12:00:00.000Z', 'en');
    console.log(JSON.stringify({ dateFormatted, fieldFormatted, instantFormatted }));
  `;
  const result = await runInTimezone('America/New_York', script);

  // Critical regression assertion: Must be October 10, NOT October 9
  assert.equal(result.dateFormatted.formatted, 'Oct 10, 2026');
  assert.equal(result.dateFormatted.dateTime, '2026-10-10');
  assert.notEqual(result.dateFormatted.formatted, 'Oct 9, 2026');

  assert.equal(result.fieldFormatted.formatted, 'Oct 10, 2026');
  assert.equal(result.fieldFormatted.dateTime, '2026-10-10');

  // Instants in America/New_York (EDT UTC-4) format to local time (12:00 UTC -> 8:00 AM EDT)
  assert.equal(result.instantFormatted.formatted, 'Oct 10, 2026, 8:00 AM');
  assert.equal(result.instantFormatted.dateTime, '2026-10-10T12:00:00.000Z');
});

test('Europe/Istanbul process preserves calendar date and formats instants in local time', async () => {
  const script = `
    import { formatCalendarDate, formatInstant } from '${HELPER_URL}';
    const dateTr = formatCalendarDate('2026-10-10', 'tr');
    const dateEn = formatCalendarDate('2026-10-10', 'en');
    const instantTr = formatInstant('2026-10-10T12:00:00.000Z', 'tr');
    console.log(JSON.stringify({ dateTr, dateEn, instantTr }));
  `;
  const result = await runInTimezone('Europe/Istanbul', script);

  assert.equal(result.dateTr.formatted, '10 Eki 2026');
  assert.equal(result.dateTr.dateTime, '2026-10-10');
  assert.equal(result.dateEn.formatted, 'Oct 10, 2026');
  assert.equal(result.dateEn.dateTime, '2026-10-10');

  // Instant in Europe/Istanbul (UTC+3): 12:00 UTC -> 15:00 local time
  assert.equal(result.instantTr.formatted, '10 Eki 2026 15:00');
  assert.equal(result.instantTr.dateTime, '2026-10-10T12:00:00.000Z');
});

test('UTC process preserves calendar date and formats instants at UTC offset', async () => {
  const script = `
    import { formatCalendarDate, formatInstant } from '${HELPER_URL}';
    const dateEn = formatCalendarDate('2026-10-10', 'en');
    const instantEn = formatInstant('2026-10-10T12:00:00.000Z', 'en');
    console.log(JSON.stringify({ dateEn, instantEn }));
  `;
  const result = await runInTimezone('UTC', script);

  assert.equal(result.dateEn.formatted, 'Oct 10, 2026');
  assert.equal(result.dateEn.dateTime, '2026-10-10');
  assert.equal(result.instantEn.formatted, 'Oct 10, 2026, 12:00 PM');
  assert.equal(result.instantEn.dateTime, '2026-10-10T12:00:00.000Z');
});
