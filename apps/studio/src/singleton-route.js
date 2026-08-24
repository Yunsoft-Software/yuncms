import { studioPath } from './studio-route.js';

export function singletonDestination(collection, collectionMeta, rows = []) {
  if (!collectionMeta?.singleton) return null;
  const primaryKey = collectionMeta.primary_key || 'id';
  const first = rows[0];
  if (first?.[primaryKey] != null) return studioPath.contentRecord(collection, first[primaryKey]);
  return studioPath.contentNew(collection);
}
