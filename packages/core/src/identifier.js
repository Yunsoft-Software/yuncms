const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertIdentifier(value, label = 'identifier') {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid SQL ${label}: ${String(value)}`);
  }

  return value;
}

export function quoteIdentifier(value, label) {
  return `\`${assertIdentifier(value, label)}\``;
}
