const ACTIONS = Object.freeze(['read', 'create', 'update', 'delete']);

export function parseCollectionMetadata(value) {
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

export function permissionResourcePolicy(collection) {
  const metadata = parseCollectionMetadata(collection?.metadata);
  const systemManaged = Boolean(collection?.system && isEnabledFlag(metadata.permissionManaged));
  const allowedActions = systemManaged && Array.isArray(metadata.allowedActions)
    ? metadata.allowedActions.filter((action) => ACTIONS.includes(action))
    : [...ACTIONS];

  return {
    systemManaged,
    actionOnly: systemManaged && metadata.permissionMode === 'action-only',
    resource: metadata.resource ?? null,
    allowedActions,
  };
}

export function isPermissionCollection(collection) {
  return !collection?.system || permissionResourcePolicy(collection).systemManaged;
}

export function canConfigurePermission(collection, action) {
  const policy = permissionResourcePolicy(collection);
  return policy.allowedActions.includes(action);
}

export function canUseAdvancedPermission(collection) {
  return !permissionResourcePolicy(collection).actionOnly;
}
