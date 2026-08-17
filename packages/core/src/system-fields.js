import { createHash } from 'node:crypto';

import { compileFieldColumn } from './field-types.js';
import { quoteIdentifier } from './identifier.js';

export const COLLECTION_SYSTEM_FIELDS = Object.freeze([
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
]);

const SYSTEM_FIELD_DEFINITIONS = Object.freeze({
  created_at: Object.freeze({
    field: 'created_at',
    type: 'timestamp',
    required: true,
    readonly: true,
    interface: 'datetime',
    special: 'date-created',
    defaultPreset: 'now',
  }),
  updated_at: Object.freeze({
    field: 'updated_at',
    type: 'timestamp',
    required: true,
    readonly: true,
    interface: 'datetime',
    special: 'date-updated',
    defaultPreset: 'now',
    autoUpdate: true,
  }),
  created_by: Object.freeze({
    field: 'created_by',
    type: 'uuid',
    required: false,
    readonly: true,
    interface: 'user',
    special: 'user-created',
  }),
  updated_by: Object.freeze({
    field: 'updated_by',
    type: 'uuid',
    required: false,
    readonly: true,
    interface: 'user',
    special: 'user-updated',
  }),
});

function invalidSystemFields(message) {
  const error = new Error(message);
  error.code = 'INVALID_SCHEMA_PAYLOAD';
  return error;
}

export function normalizeCollectionSystemFields(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalidSystemFields('systemFields must be an array');

  const normalized = [...new Set(value)];
  for (const field of normalized) {
    if (!COLLECTION_SYSTEM_FIELDS.includes(field)) {
      throw invalidSystemFields(`Unsupported system field: ${String(field)}`);
    }
  }
  return COLLECTION_SYSTEM_FIELDS.filter((field) => normalized.includes(field));
}

export function systemFieldDefinition(field) {
  return SYSTEM_FIELD_DEFINITIONS[field] ?? null;
}

function foreignKeyName(collection, field) {
  const digest = createHash('sha256')
    .update(`${collection}:${field}:system-user`)
    .digest('hex')
    .slice(0, 24);
  return `ysf_${digest}`;
}

export function compileCollectionSystemFields(collection, requestedFields) {
  const fields = normalizeCollectionSystemFields(requestedFields);
  const columns = [];
  const constraints = [];
  const metadata = [];

  for (const field of fields) {
    const definition = SYSTEM_FIELD_DEFINITIONS[field];
    const compiled = compileFieldColumn(definition);
    columns.push(`${quoteIdentifier(field, 'system field')} ${compiled.sql}`);
    metadata.push({
      collection,
      field,
      type: definition.type,
      required: definition.required,
      readonly: true,
      hidden: false,
      interface: definition.interface,
      schemaMetadata: {
        ...compiled.schemaMetadata,
        special: definition.special,
        systemManaged: true,
      },
    });

    if (field === 'created_by' || field === 'updated_by') {
      constraints.push(
        `CONSTRAINT ${quoteIdentifier(foreignKeyName(collection, field), 'system field constraint')} `
        + `FOREIGN KEY (${quoteIdentifier(field, 'system field')}) REFERENCES yuncms_users (id) ON DELETE SET NULL`,
      );
    }
  }

  return { fields, columns, constraints, metadata };
}

function parseSchemaMetadata(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value) ?? {};
  } catch {
    return {};
  }
}

export function fieldSpecial(fieldSchema) {
  return parseSchemaMetadata(fieldSchema?.schema_metadata).special ?? null;
}

export function isSystemManagedField(fieldSchema) {
  return Boolean(fieldSpecial(fieldSchema));
}

export function systemMutationEntries(schema, accountability, operation, now = new Date()) {
  const entries = [];
  for (const fieldSchema of Object.values(schema?.fields ?? {})) {
    const special = fieldSpecial(fieldSchema);
    if (operation === 'create' && special === 'date-created') entries.push([fieldSchema.field, now]);
    if ((operation === 'create' || operation === 'update') && special === 'date-updated') entries.push([fieldSchema.field, now]);
    if (operation === 'create' && special === 'user-created') entries.push([fieldSchema.field, accountability?.user ?? null]);
    if ((operation === 'create' || operation === 'update') && special === 'user-updated') entries.push([fieldSchema.field, accountability?.user ?? null]);
  }
  return entries;
}
