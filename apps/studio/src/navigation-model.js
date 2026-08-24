import { collectionUi } from './collection-ui.js';

export function sortNavigationGroups(groups = []) {
  return [...groups].sort((left, right) => (
    Number(left.sort ?? 0) - Number(right.sort ?? 0)
    || String(left.name ?? '').localeCompare(String(right.name ?? ''))
    || String(left.id ?? '').localeCompare(String(right.id ?? ''))
  ));
}

export function sortNavigationCollections(collections = [], groupId = null) {
  return collections
    .filter((entry) => !entry.system && collectionUi(entry).group === groupId)
    .slice()
    .sort((left, right) => (
      collectionUi(left).sort - collectionUi(right).sort
      || String(left.collection).localeCompare(String(right.collection))
    ));
}

export function buildNavigationModel(collections = [], groups = [], { includeHidden = true } = {}) {
  const validGroupIds = new Set(groups.map((group) => group.id));
  const project = collections.filter((entry) => !entry.system && (includeHidden || !entry.hidden));
  const normalized = project.map((entry) => {
    const ui = collectionUi(entry);
    return {
      ...entry,
      navigationGroup: ui.group && validGroupIds.has(ui.group) ? ui.group : null,
      navigationSort: ui.sort,
    };
  });
  const roots = normalized
    .filter((entry) => entry.navigationGroup == null)
    .sort((a, b) => a.navigationSort - b.navigationSort || a.collection.localeCompare(b.collection));
  const grouped = sortNavigationGroups(groups).map((group) => ({
    ...group,
    collections: normalized
      .filter((entry) => entry.navigationGroup === group.id)
      .sort((a, b) => a.navigationSort - b.navigationSort || a.collection.localeCompare(b.collection)),
  }));
  return { roots, groups: grouped };
}

function orderedGroupMembers(collections, groupId, sourceName = null) {
  return collections
    .filter((entry) => !entry.system && entry.collection !== sourceName && collectionUi(entry).group === groupId)
    .slice()
    .sort((a, b) => collectionUi(a).sort - collectionUi(b).sort || a.collection.localeCompare(b.collection));
}

export function collectionDropPatches(collections, sourceName, { targetName = null, groupId = null } = {}) {
  const source = collections.find((entry) => entry.collection === sourceName && !entry.system);
  if (!source) return [];

  const target = targetName
    ? collections.find((entry) => entry.collection === targetName && !entry.system)
    : null;
  const targetGroup = target ? collectionUi(target).group : groupId;
  const members = orderedGroupMembers(collections, targetGroup, sourceName);
  let insertAt = members.length;
  if (target) {
    const index = members.findIndex((entry) => entry.collection === target.collection);
    if (index >= 0) insertAt = index;
  }
  members.splice(insertAt, 0, source);

  return members.map((entry, index) => ({
    collection: entry.collection,
    group: targetGroup ?? null,
    sort: (index + 1) * 10,
  }));
}

export function groupDropPatches(groups, sourceId, targetId) {
  const ordered = sortNavigationGroups(groups);
  const sourceIndex = ordered.findIndex((entry) => entry.id === sourceId);
  const targetIndex = ordered.findIndex((entry) => entry.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [];
  const [source] = ordered.splice(sourceIndex, 1);
  ordered.splice(targetIndex, 0, source);
  return ordered.map((entry, index) => ({ id: entry.id, sort: (index + 1) * 10 }));
}
