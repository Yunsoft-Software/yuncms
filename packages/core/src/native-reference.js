import { compileFilter, compileSelectFields, QUERY_LIMITS } from './query.js';
import { quoteIdentifier } from './identifier.js';
import { USER_SAFE_SELECT_COLUMNS } from './system-list-query.js';

export const NATIVE_REFERENCE_TARGETS = Object.freeze(['yuncms_users', 'yuncms_files']);
export const FILE_REFERENCE_FIELDS = Object.freeze(['id', 'filename_download', 'title', 'mimetype', 'filesize', 'uploaded_by', 'uploaded_at', 'metadata']);

export function nativeReferenceError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function assertNativeReferenceTarget(collection, onDelete = 'RESTRICT') {
  if (!NATIVE_REFERENCE_TARGETS.includes(collection)) throw nativeReferenceError('UNSUPPORTED_RELATION_TARGET', 'Native references support yuncms_users and yuncms_files only');
  if (!['RESTRICT', 'SET NULL'].includes(onDelete)) throw nativeReferenceError('INVALID_ON_DELETE', 'Native identities support RESTRICT or SET NULL only');
}

export async function readNativeReferenceRows(service, collection, permission, { fields = ['*'], lookupField = 'id', values = [] } = {}) {
  if (lookupField !== 'id') throw nativeReferenceError('UNSUPPORTED_RELATION_TARGET', 'Native reference lookup requires id');
  if (!Array.isArray(values) || values.length > 2_000 || values.some(value => typeof value !== 'string')) throw nativeReferenceError('INVALID_QUERY', 'Native reference values must be a bounded string array');
  const fullSchema = service.schema?.collections?.[collection];
  if (!fullSchema) throw nativeReferenceError('SYSTEM_SCHEMA_REQUIRED', 'Native relation reads require system schema metadata');
  const safeFields = collection === 'yuncms_users' ? USER_SAFE_SELECT_COLUMNS : FILE_REFERENCE_FIELDS;
  const allowed = safeFields.filter(field => fullSchema.fields[field] && (!permission.fields || permission.fields.includes(field)));
  if (!allowed.includes('id')) throw nativeReferenceError('FORBIDDEN_FIELD', 'Native relation primary key is not readable');
  const safeSchema = { ...fullSchema, fields: Object.fromEntries(allowed.map(field => [field, fullSchema.fields[field]])) };
  const visibleFields = compileSelectFields(fields.length ? fields : ['id'], safeSchema).fields;
  const selection = compileSelectFields([...new Set(['id', ...visibleFields])], safeSchema);
  const scope = compileFilter(permission.filter, fullSchema, { dynamicVariables: { user: service.accountability.user, role: service.accountability.role, now: new Date() } });
  const data = [];
  for (let offset = 0; offset < values.length; offset += QUERY_LIMITS.maxInValues) {
    const chunk = values.slice(offset, offset + QUERY_LIMITS.maxInValues);
    const lookup = compileFilter({ id: { _in: chunk } }, fullSchema);
    const predicates = [scope, lookup].filter(part => part.sql);
    const where = ` WHERE ${predicates.map(part => `(${part.sql.replace(/^ WHERE /, '')})`).join(' AND ')}`;
    const [rows] = await service.database.query(`SELECT ${selection.sql} FROM ${quoteIdentifier(collection)}${where} LIMIT ?`, [...predicates.flatMap(part => part.params), chunk.length]);
    data.push(...rows.map(row => {
      if (collection !== 'yuncms_files' || !Object.hasOwn(row, 'metadata') || typeof row.metadata !== 'string') return row;
      return { ...row, metadata: JSON.parse(row.metadata) };
    }));
  }
  return { data, visibleFields };
}
