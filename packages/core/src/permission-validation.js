import { compileFilter } from './query.js';

function validationError(message, path = null) {
  const error = new Error(message);
  error.code = 'VALIDATION_FAILED';
  if (path) error.path = path;
  return error;
}

function compare(operator, actual, expected) {
  switch (operator) {
    case '_eq': return actual === expected;
    case '_neq': return actual !== expected;
    case '_lt': return actual != null && actual < expected;
    case '_lte': return actual != null && actual <= expected;
    case '_gt': return actual != null && actual > expected;
    case '_gte': return actual != null && actual >= expected;
    case '_in': return expected.some((candidate) => actual === candidate);
    case '_nin': return !expected.some((candidate) => actual === candidate);
    case '_null': return expected ? actual == null : actual != null;
    case '_nnull': return expected ? actual != null : actual == null;
    case '_contains': return actual != null && String(actual).includes(String(expected));
    case '_starts_with': return actual != null && String(actual).startsWith(String(expected));
    case '_ends_with': return actual != null && String(actual).endsWith(String(expected));
    default: return false;
  }
}

function evaluateNode(record, node) {
  for (const [key, value] of Object.entries(node)) {
    if (key === '_and') {
      if (!value.every((child) => evaluateNode(record, child))) return false;
      continue;
    }
    if (key === '_or') {
      if (!value.some((child) => evaluateNode(record, child))) return false;
      continue;
    }

    const actual = record[key];
    for (const [operator, expected] of Object.entries(value)) {
      if (!compare(operator, actual, expected)) return false;
    }
  }
  return true;
}

export function assertPermissionValidationRule(rule, schema) {
  if (rule == null) return null;
  compileFilter(rule, schema);
  return rule;
}

export function evaluatePermissionValidation(record, rule, schema) {
  if (rule == null) return true;
  assertPermissionValidationRule(rule, schema);
  return evaluateNode(record, rule);
}

export function enforcePermissionValidation(record, rule, schema, { path = 'validation' } = {}) {
  if (evaluatePermissionValidation(record, rule, schema)) return record;
  throw validationError('Record does not satisfy the permission validation rule', path);
}
