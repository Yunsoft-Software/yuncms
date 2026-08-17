const ALL_ACTIONS = Object.freeze(['read', 'create', 'update', 'delete']);

function parseMetadata(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value) ?? {};
  } catch {
    return {};
  }
}

export function systemPermissionConfig(collectionSchema) {
  if (!collectionSchema?.system) return null;
  const metadata = parseMetadata(collectionSchema.metadata);
  if (metadata.permissionManaged !== true) return null;
  const allowedActions = Array.isArray(metadata.allowedActions)
    ? metadata.allowedActions.filter((action) => ALL_ACTIONS.includes(action))
    : [];
  return Object.freeze({
    resource: metadata.resource ?? collectionSchema.collection,
    mode: metadata.permissionMode ?? 'action-only',
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

export function assertActionOnlyPermissionPayload(collectionSchema, { fields, filter, validation } = {}) {
  const config = systemPermissionConfig(collectionSchema);
  if (!config || config.mode !== 'action-only') return;
  if (fields != null || filter != null || validation != null) {
    const error = new Error(`System resource ${collectionSchema.collection} supports action-level permissions only`);
    error.code = 'SYSTEM_PERMISSION_ADVANCED_UNSUPPORTED';
    throw error;
  }
}
