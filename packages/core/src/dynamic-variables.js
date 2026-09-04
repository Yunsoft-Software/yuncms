const NOW_PATTERN = /^\$NOW(?:\(([+-]\d+)\s+(second|minute|hour|day|week|month|year)s?\))?$/i;
const MAX_ADJUSTMENT = 10_000;

function dynamicVariableError(code, message, path = null) {
  const error = new Error(message);
  error.code = code;
  if (path) error.path = path;
  return error;
}

function normalizedNow(value) {
  const date = value == null ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw dynamicVariableError('INVALID_QUERY', 'Dynamic variable context contains an invalid current timestamp');
  }
  return date;
}

function adjustNow(now, amount, unit, path) {
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > MAX_ADJUSTMENT) {
    throw dynamicVariableError(
      'INVALID_QUERY',
      `$NOW adjustment must be a signed integer between -${MAX_ADJUSTMENT} and ${MAX_ADJUSTMENT}`,
      path,
    );
  }

  const result = new Date(now.getTime());
  switch (unit.toLowerCase()) {
    case 'second': result.setUTCSeconds(result.getUTCSeconds() + amount); break;
    case 'minute': result.setUTCMinutes(result.getUTCMinutes() + amount); break;
    case 'hour': result.setUTCHours(result.getUTCHours() + amount); break;
    case 'day': result.setUTCDate(result.getUTCDate() + amount); break;
    case 'week': result.setUTCDate(result.getUTCDate() + (amount * 7)); break;
    case 'month': result.setUTCMonth(result.getUTCMonth() + amount); break;
    case 'year': result.setUTCFullYear(result.getUTCFullYear() + amount); break;
    default: throw dynamicVariableError('INVALID_QUERY', `Unsupported $NOW adjustment unit: ${unit}`, path);
  }
  if (Number.isNaN(result.getTime())) {
    throw dynamicVariableError('INVALID_QUERY', '$NOW adjustment produced an invalid timestamp', path);
  }
  return result;
}

export function resolveDynamicVariable(value, context = {}, { allowUnresolved = false, path = null } = {}) {
  if (typeof value !== 'string') return value;

  if (value === '$CURRENT_USER' || value === '$CURRENT_ROLE') {
    if (allowUnresolved) return value;
    const key = value === '$CURRENT_USER' ? 'user' : 'role';
    const resolved = context?.[key];
    if (resolved == null || resolved === '') {
      throw dynamicVariableError(
        'FORBIDDEN',
        `${value} is unavailable for the current accountability context`,
        path,
      );
    }
    return String(resolved);
  }

  if (value === '$NOW' || value.toUpperCase().startsWith('$NOW(')) {
    const match = value.match(NOW_PATTERN);
    if (!match) {
      throw dynamicVariableError(
        'INVALID_QUERY',
        'Invalid $NOW value; use $NOW or a signed adjustment such as $NOW(-1 day)',
        path,
      );
    }
    if (allowUnresolved) return value;
    const now = normalizedNow(context?.now);
    return match[1] ? adjustNow(now, Number(match[1]), match[2], path) : now;
  }

  if (value.startsWith('$CURRENT_USER.') || value.startsWith('$CURRENT_ROLE.')) {
    throw dynamicVariableError(
      'INVALID_QUERY',
      'Nested current-user and current-role fields are not supported in YunCMS V1',
      path,
    );
  }

  return value;
}

export function resolveDynamicVariables(value, context = {}, options = {}) {
  const path = options.path ?? 'filter';
  if (Array.isArray(value)) {
    return value.map((entry, index) => resolveDynamicVariables(entry, context, {
      ...options,
      path: `${path}.${index}`,
    }));
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      resolveDynamicVariables(entry, context, { ...options, path: `${path}.${key}` }),
    ]));
  }
  return resolveDynamicVariable(value, context, options);
}

export const DYNAMIC_FILTER_VALUES = Object.freeze([
  '$CURRENT_USER',
  '$CURRENT_ROLE',
  '$NOW',
  '$NOW(-1 day)',
  '$NOW(+1 day)',
]);
