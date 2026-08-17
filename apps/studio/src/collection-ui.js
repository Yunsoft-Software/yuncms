import { DEFAULT_COLLECTION_ICON, normalizeCollectionIcon } from './collection-icons.js';

export function parseCollectionMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value) ?? {};
  } catch {
    return {};
  }
}

export function collectionUi(collection) {
  const metadata = parseCollectionMetadata(collection?.metadata);
  return {
    icon: normalizeCollectionIcon(metadata.icon || DEFAULT_COLLECTION_ICON),
    sort: Number.isFinite(Number(metadata.sort)) ? Number(metadata.sort) : 999999,
    hidden: Boolean(collection?.hidden),
  };
}

export function sortContentCollections(collections = []) {
  return collections
    .filter((entry) => !entry.system && !entry.hidden)
    .slice()
    .sort((left, right) => {
      const leftUi = collectionUi(left);
      const rightUi = collectionUi(right);
      return leftUi.sort - rightUi.sort || String(left.collection).localeCompare(String(right.collection));
    });
}

export function collectionMetadataPatch(collection, patch = {}) {
  const current = parseCollectionMetadata(collection?.metadata);
  return {
    ...current,
    ...patch,
  };
}
