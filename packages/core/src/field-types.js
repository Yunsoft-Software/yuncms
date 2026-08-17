const TYPE_NAMES = new Set([
  'integer',
  'bigint',
  'decimal',
  'string',
  'text',
  'boolean',
  'date',
  'datetime',
  'timestamp',
  'json',
  'uuid',
]);

const FILE_INTERFACES = new Set(['file', 'image']);

function integerOption(value, fallback, { min, max, label }) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

export function assertFieldType(type) {
  if (!TYPE_NAMES.has(type)) {
    const error = new Error(`Unsupported field type: ${String(type)}`);
    error.code = 'UNSUPPORTED_FIELD_TYPE';
    throw error;
  }
  return type;
}

function assertInterfaceStorage(type, fieldInterface) {
  if (!FILE_INTERFACES.has(fieldInterface)) return;
  if (type !== 'uuid') {
    const error = new Error(`${fieldInterface} interface requires uuid storage`);
    error.code = 'INVALID_FIELD_INTERFACE';
    throw error;
  }
}

export function compileFieldColumn(input = {}) {
  const type = assertFieldType(input.type);
  assertInterfaceStorage(type, input.interface);
  const params = [];
  let sqlType;

  switch (type) {
    case 'integer':
      sqlType = 'INT';
      break;
    case 'bigint':
      sqlType = 'BIGINT';
      break;
    case 'decimal': {
      const precision = integerOption(input.precision, 18, { min: 1, max: 65, label: 'Decimal precision' });
      const scale = integerOption(input.scale, 2, { min: 0, max: 30, label: 'Decimal scale' });
      if (scale > precision) throw new Error('Decimal scale cannot exceed precision');
      sqlType = `DECIMAL(${precision}, ${scale})`;
      break;
    }
    case 'string': {
      const length = integerOption(input.length, 255, { min: 1, max: 4096, label: 'String length' });
      sqlType = `VARCHAR(${length})`;
      break;
    }
    case 'text':
      sqlType = 'TEXT';
      break;
    case 'boolean':
      sqlType = 'TINYINT(1)';
      break;
    case 'date':
      sqlType = 'DATE';
      break;
    case 'datetime':
      sqlType = 'DATETIME(3)';
      break;
    case 'timestamp':
      sqlType = 'TIMESTAMP(3)';
      break;
    case 'json':
      sqlType = 'JSON';
      break;
    case 'uuid':
      sqlType = 'CHAR(36)';
      break;
    default:
      throw new Error(`Unsupported field type: ${type}`);
  }

  let sql = sqlType;
  sql += input.required === true ? ' NOT NULL' : ' NULL';

  if (Object.hasOwn(input, 'defaultValue')) {
    if (type === 'text' || type === 'json') {
      const error = new Error(`Defaults for ${type} fields are postponed in V1`);
      error.code = 'UNSUPPORTED_FIELD_DEFAULT';
      throw error;
    }

    if (input.defaultValue === null) {
      if (input.required === true) throw new Error('Required fields cannot default to NULL');
      sql += ' DEFAULT NULL';
    } else {
      sql += ' DEFAULT ?';
      params.push(type === 'boolean' ? (input.defaultValue ? 1 : 0) : input.defaultValue);
    }
  }

  return {
    sql,
    params,
    schemaMetadata: {
      length: type === 'string' ? (input.length ?? 255) : type === 'uuid' ? 36 : undefined,
      precision: type === 'decimal' ? (input.precision ?? 18) : undefined,
      scale: type === 'decimal' ? (input.scale ?? 2) : undefined,
      defaultValue: Object.hasOwn(input, 'defaultValue') ? input.defaultValue : undefined,
    },
  };
}
