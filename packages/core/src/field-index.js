import { createHash } from 'node:crypto';
import { quoteIdentifier } from './identifier.js';

export function assertFieldIndexOptions(input) {
  for (const key of ['indexed', 'unique']) {
    if (Object.hasOwn(input, key) && typeof input[key] !== 'boolean') {
      throw Object.assign(new Error(`${key} must be boolean`), { code: 'INVALID_SCHEMA_PAYLOAD' });
    }
  }
  if ((input.indexed || input.unique) && (
    ['text', 'json'].includes(input.type) || (input.type === 'string' && (input.length ?? 255) > 768)
  )) {
    throw Object.assign(new Error('Field indexes require scalar storage; string length cannot exceed 768'), {
      code: 'INVALID_SCHEMA_PAYLOAD',
    });
  }
}

export function fieldIndexClause(collection, field, options) {
  if (!options.unique && !options.indexed) return null;
  const name = fieldIndexName(collection, field);
  return `ADD ${options.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdentifier(name, 'index name')} (${quoteIdentifier(field, 'field name')})`;
}

export function fieldIndexName(collection, field) {
  const digest = createHash('sha256').update(`${collection}:${field}:index`).digest('hex').slice(0, 24);
  return `yidx_${digest}`;
}

export async function assertNoDuplicateFieldValues(database, collection, field) {
  const table = quoteIdentifier(collection, 'collection name'), column = quoteIdentifier(field, 'field name');
  // GROUP BY uses the same column collation as the full unique index. NULL is not a conflict.
  const [rows] = await database.query(
    `SELECT 1 AS duplicate FROM ${table} WHERE ${column} IS NOT NULL GROUP BY ${column} HAVING COUNT(*) > 1 LIMIT 1`,
  );
  if (rows.length) throw Object.assign(new Error('Existing non-null values conflict with the unique constraint'), {
    code: 'DUPLICATE_KEY',
  });
}

export function safeFieldIndexError(error) {
  if (error.code !== 'ER_DUP_ENTRY') return error;
  return Object.assign(new Error('Existing non-null values conflict with the unique constraint', { cause: error }), {
    code: 'DUPLICATE_KEY',
  });
}
