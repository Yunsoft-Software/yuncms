import { createHash, randomUUID } from 'node:crypto';
import { compileFieldColumn } from './field-types.js';
import { assertFieldIndexOptions, fieldIndexClause } from './field-index.js';
import { quoteIdentifier } from './identifier.js';

export function fieldRecoveryError(code, collection, field) {
  return Object.assign(new Error(`${code}: ${collection}.${field}`), { code, collection, field });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function fieldRecoverySignature({ collection, field, definition, physical, schemaVersion }) {
  return createHash('sha256').update(JSON.stringify(canonical({ collection, field, definition, physical, schemaVersion }))).digest('hex');
}

function columnShape(row) {
  if (!row) return null;
  return { type: row.Type, collation: row.Collation, nullable: row.Null === 'YES', default: row.Default,
    // MySQL 8.4 reports literal "NULL" for an empty temporary-column Extra.
    extra: row.Extra == null || row.Extra === 'NULL' ? '' : row.Extra, comment: row.Comment };
}

async function physicalColumn(database, collection, field) {
  const table = quoteIdentifier(collection, 'collection name');
  const [columns] = await database.query(`SHOW FULL COLUMNS FROM ${table} WHERE Field = ?`, [field]);
  const [allIndexes] = await database.query(`SHOW INDEX FROM ${table}`);
  const relevant = new Set(allIndexes.filter(row => row.Column_name === field).map(row => row.Key_name));
  const indexes = allIndexes.filter(row => relevant.has(row.Key_name)).map(row => ({
    name: row.Key_name, unique: Number(row.Non_unique) === 0, position: Number(row.Seq_in_index),
    field: row.Column_name, prefix: row.Sub_part, type: row.Index_type,
    visible: row.Visible ?? (row.Ignored === 'YES' ? 'NO' : 'YES'), comment: row.Index_comment ?? '',
  })).sort((a, b) => a.name.localeCompare(b.name) || a.position - b.position);
  return { column: columnShape(columns[0]), indexes };
}

export function compatibleFieldRecovery(physical, expected) {
  return physical.column !== null && !physical.foreignKeys.length && !physical.checkConstraints.length
    && JSON.stringify(canonical({ column: physical.column, indexes: physical.indexes })) === JSON.stringify(canonical(expected));
}

// Empty temporary DDL asks the actual server to normalize types, defaults and
// collation. It never alters, copies or drops the original table or its records.
export async function inspectFieldRecovery(database, collection, field, definition, schemaVersion) {
  assertFieldIndexOptions(definition);
  const compiled = compileFieldColumn(definition);
  if (definition.type === 'json') throw fieldRecoveryError('UNSUPPORTED_SCHEMA_RECOVERY', collection, field);
  const physical = await physicalColumn(database, collection, field);
  if (!physical.column) throw fieldRecoveryError('FIELD_NOT_FOUND', collection, field);
  const [foreignKeys] = await database.query(`SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME,
    REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE (TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL)
       OR (REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME=?)
    ORDER BY TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME`, [collection, field, collection, field]);
  const [checkTableColumn] = await database.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='information_schema' AND TABLE_NAME='CHECK_CONSTRAINTS' AND COLUMN_NAME='TABLE_NAME'");
  const [checks] = await database.query(`SELECT c.CONSTRAINT_NAME, c.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS c
    JOIN information_schema.TABLE_CONSTRAINTS t ON t.CONSTRAINT_SCHEMA=c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME=c.CONSTRAINT_NAME
    ${checkTableColumn.length ? 'AND c.TABLE_NAME=t.TABLE_NAME' : ''}
    WHERE t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME=? AND t.CONSTRAINT_TYPE='CHECK' ORDER BY c.CONSTRAINT_NAME`, [collection]);
  const reference = new RegExp(`(^|[^a-z0-9_])${field}([^a-z0-9_]|$)`, 'i');
  physical.foreignKeys = foreignKeys;
  physical.checkConstraints = checks.filter(row => reference.test(row.CHECK_CLAUSE));
  const [[table]] = await database.query('SELECT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [collection]);
  const temporary = '_yuncms_recover_' + randomUUID().replaceAll('-', '');
  const name = quoteIdentifier(temporary, 'temporary table name');
  const index = fieldIndexClause(collection, field, definition);
  let created = false, expected;
  try {
    await database.query(`CREATE TEMPORARY TABLE ${name} (${quoteIdentifier(field)} ${compiled.sql}${index ? ', ' + index.slice(4) : ''}) ENGINE=InnoDB COLLATE=${quoteIdentifier(table.TABLE_COLLATION)}`, compiled.params);
    created = true;
    expected = await physicalColumn(database, temporary, field);
  } finally {
    if (created) await database.query(`DROP TEMPORARY TABLE ${name}`);
  }
  return { collection, field, physical, expected, schemaVersion,
    compatible: compatibleFieldRecovery(physical, expected),
    signature: fieldRecoverySignature({ collection, field, definition, physical, schemaVersion }) };
}
