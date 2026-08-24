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

export function legacyCollectionSort(collection = '') {
  const normalized = String(collection).toLowerCase();
  let prefix = 0;
  for (let index = 0; index < 6; index += 1) {
    const code = normalized.charCodeAt(index) || 0;
    prefix = (prefix * 128) + Math.min(code, 127);
  }

  let suffixHash = 2166136261;
  for (const character of normalized.slice(6)) {
    suffixHash ^= character.charCodeAt(0);
    suffixHash = Math.imul(suffixHash, 16777619) >>> 0;
  }
  return (prefix * 1000) + (suffixHash % 1000);
}

export function collectionUi(collection) {
  const metadata = parseCollectionMetadata(collection?.metadata);
  const explicitSort = Number(metadata.sort);
  const group = typeof metadata.group === 'string' && metadata.group.trim()
    ? metadata.group.trim()
    : null;
  return {
    icon: normalizeCollectionIcon(metadata.icon || DEFAULT_COLLECTION_ICON),
    sort: Number.isFinite(explicitSort) ? explicitSort : legacyCollectionSort(collection?.collection),
    hidden: Boolean(collection?.hidden),
    group,
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
  const next = { ...current, ...patch };
  if (next.group == null || next.group === '') delete next.group;
  return next;
}
