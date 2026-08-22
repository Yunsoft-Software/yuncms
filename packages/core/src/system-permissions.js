const ALL_ACTIONS = Object.freeze(['read', 'create', 'update', 'delete']);
const PERMISSION_MODES = new Set(['action-only', 'filter-read']);

function parseMetadata(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value) ?? {};
  } catch {
    return {};
  }
}

function isEnabledFlag(value) {
  return value === true || value === 1;
}

function advancedUnsupported(collectionSchema, message) {
  const error = new Error(message ?? `System resource ${collectionSchema.collection} does not support this advanced permission rule`);
  error.code = 'SYSTEM_PERMISSION_ADVANCED_UNSUPPORTED';
  throw error;
}

export function systemPermissionConfig(collectionSchema) {
  if (!collectionSchema?.system) return null;
  const metadata = parseMetadata(collectionSchema.metadata);
  if (!isEnabledFlag(metadata.permissionManaged)) return null;
  const mode = metadata.permissionMode ?? 'action-only';
  if (!PERMISSION_MODES.has(mode)) {
    const error = new Error(`Unsupported system permission mode for ${collectionSchema.collection}: ${mode}`);
    error.code = 'SYSTEM_PERMISSION_MODE_UNSUPPORTED';
    throw error;
  }
  const allowedActions = Array.isArray(metadata.allowedActions)
    ? metadata.allowedActions.filter((action) => ALL_ACTIONS.includes(action))
    : [];
  return Object.freeze({
    resource: metadata.resource ?? collectionSchema.collection,
    mode,
    allowedActions: Object.freeze([...new Set(allowedActions)]),
  });
}

export function isPermissionManagedSystemResource(collectionSchema) {
  return Boolean(systemPermissionConfig(collectionSchema));
}

export function assertSystemResourceAction(collectionSchema, action) {
  const config = systemPermissionConfig(collectionSchema);
  if (!config) return null;
  if (!config.allowedActions.includes(action)) {
    const error = new Error(`Action ${action} is protected for system resource ${collectionSchema.collection}`);
    error.code = 'SYSTEM_PERMISSION_ACTION_PROTECTED';
    throw error;
  }
  return config;
}

export function assertSystemPermissionPayload(
  collectionSchema,
  action,
  { fields, filter, validation } = {},
) {
  const config = systemPermissionConfig(collectionSchema);
  if (!config) return;

  if (config.mode === 'action-only') {
    if (fields != null || filter != null || validation != null) {
      advancedUnsupported(
        collectionSchema,
        `System resource ${collectionSchema.collection} supports action-level permissions only`,
      );
    }
    return;
  }

  if (config.mode === 'filter-read') {
    if (fields != null || validation != null) {
      advancedUnsupported(
        collectionSchema,
        `System resource ${collectionSchema.collection} supports only a row filter on read permissions`,
      );
    }
    if (filter != null && action !== 'read') {
      advancedUnsupported(
        collectionSchema,
        `System resource ${collectionSchema.collection} permits row filters only for read`,
      );
    }
  }
}

export function assertActionOnlyPermissionPayload(collectionSchema, payload = {}) {
  const config = systemPermissionConfig(collectionSchema);
  if (!config || config.mode !== 'action-only') return;
  return assertSystemPermissionPayload(collectionSchema, 'read', payload);
}
