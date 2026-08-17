export function parseCollectionMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function isContentCollection(collection) {
  return Boolean(collection) && !Boolean(collection.system) && !Boolean(collection.hidden);
}

export function isJunctionCollection(collection) {
  return parseCollectionMetadata(collection?.metadata).junction === true;
}

export function collectionVisibilityLabel(collection) {
  return Boolean(collection?.hidden) ? 'Hidden from Content' : 'Visible in Content';
}
