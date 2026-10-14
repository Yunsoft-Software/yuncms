const CRON_FIELD_RULES = Object.freeze([
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'weekday', min: 0, max: 6 },
]);

function scheduleError(message) {
  const error = new Error(message);
  error.code = 'INVALID_EXTENSION_SCHEDULE';
  return error;
}

function integerToken(value, rule, label) {
  if (!/^\d+$/.test(value)) throw scheduleError(`Invalid ${label} cron token: ${value}`);
  const number = Number(value);
  if (!Number.isInteger(number) || number < rule.min || number > rule.max) {
    throw scheduleError(`${label} must be between ${rule.min} and ${rule.max}`);
  }
  return number;
}

function rangeValues(start, end, step, rule, label) {
  if (start > end) throw scheduleError(`Invalid ${label} cron range: ${start}-${end}`);
  const values = [];
  for (let value = start; value <= end; value += step) values.push(value);
  return values;
}

function parseCronPart(part, rule) {
  const [base, rawStep, extra] = part.split('/');
  if (extra !== undefined) throw scheduleError(`Invalid ${rule.name} cron token: ${part}`);
  const step = rawStep === undefined ? 1 : integerToken(rawStep, { min: 1, max: rule.max - rule.min + 1 }, `${rule.name} step`);

  if (base === '*') return rangeValues(rule.min, rule.max, step, rule, rule.name);
  if (base.includes('-')) {
    const bits = base.split('-');
    if (bits.length !== 2) throw scheduleError(`Invalid ${rule.name} cron range: ${base}`);
    return rangeValues(
      integerToken(bits[0], rule, rule.name),
      integerToken(bits[1], rule, rule.name),
      step,
      rule,
      rule.name,
    );
  }
  if (rawStep !== undefined) throw scheduleError(`Cron step requires * or range for ${rule.name}`);
  return [integerToken(base, rule, rule.name)];
}

function parseCronField(value, rule) {
  if (!value) throw scheduleError(`Cron ${rule.name} field is required`);
  const values = new Set();
  for (const part of value.split(',')) {
    if (!part) throw scheduleError(`Invalid ${rule.name} cron list`);
    for (const number of parseCronPart(part, rule)) values.add(number);
  }
  return values;
}

export function parseCronExpression(expression) {
  if (typeof expression !== 'string') throw scheduleError('Cron expression must be a string');
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw scheduleError('Cron expression must contain exactly 5 fields');
  return Object.freeze(CRON_FIELD_RULES.map((rule, index) => parseCronField(fields[index], rule)));
}

export function cronMatches(parsed, date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('Valid date is required');
  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];
  return parsed.every((allowed, index) => allowed.has(values[index]));
}


export function parseFlowCronExpression(expression) {
  if (typeof expression !== 'string') throw scheduleError('Cron expression must be a string');
  const fields = expression.trim().split(/\s+/);
  if (![5, 6].includes(fields.length)) throw scheduleError('Flow cron requires 5 or 6 fields');
  const seconds = fields.length === 6 ? parseCronField(fields.shift(), { name: 'second', min: 0, max: 59 }) : new Set([0]);
  return { seconds, fields: parseCronExpression(fields.join(' ')), precision: expression.trim().split(/\s+/).length === 6 ? 'second' : 'minute' };
}

export function flowCronMatchesUtc(parsed, date) {
  const values = [date.getUTCMinutes(), date.getUTCHours(), date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCDay()];
  return parsed.seconds.has(date.getUTCSeconds()) && parsed.fields.every((allowed, index) => allowed.has(values[index]));
}
