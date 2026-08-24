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
    collapse: ['open', 'closed', 'locked'].includes(group.collapse) ? group.collapse : 'open',
    collections: normalized
      .filter((entry) => entry.navigationGroup === group.id)
      .sort((a, b) => a.navigationSort - b.navigationSort || a.collection.localeCompare(b.collection)),
  }));
  const nodes = [
    ...roots.map((entry) => ({
      type: 'collection',
      id: entry.collection,
      sort: entry.navigationSort,
      entry,
    })),
    ...grouped.map((group) => ({
      type: 'group',
      id: group.id,
      sort: Number(group.sort ?? 0),
      group,
    })),
  ].sort((left, right) => (
    left.sort - right.sort
    || (left.type === right.type ? 0 : left.type === 'group' ? -1 : 1)
    || String(left.type === 'group' ? left.group.name : left.entry.collection)
      .localeCompare(String(right.type === 'group' ? right.group.name : right.entry.collection))
  ));
  return { roots, groups: grouped, nodes };
}

export function navigationPointerPosition({ top = 0, height = 0, clientY = 0, allowInside = false } = {}) {
  const ratio = height > 0 ? (clientY - top) / height : 0.5;
  if (allowInside && ratio >= 0.25 && ratio <= 0.75) return 'inside';
  return ratio < 0.5 ? 'before' : 'after';
}

function insertRelative(list, value, target, position = 'before') {
  const index = list.findIndex((entry) => entry.type === target?.type && entry.id === target?.id);
  if (index < 0) return [...list, value];
  const next = [...list];
  next.splice(index + (position === 'after' ? 1 : 0), 0, value);
  return next;
}

function changedCollectionPatch(entry, group, sort) {
  const ui = collectionUi(entry);
  if (ui.group === group && ui.sort === sort) return null;
  return { collection: entry.collection, group, sort };
}

export function navigationDropPatches(collections = [], groups = [], source = {}, target = {}) {
  const model = buildNavigationModel(collections, groups);
  const sourceCollection = source.type === 'collection'
    ? collections.find((entry) => !entry.system && entry.collection === source.id)
    : null;
  const sourceGroup = source.type === 'group'
    ? model.groups.find((group) => group.id === source.id)
    : null;
  if (!sourceCollection && !sourceGroup) return { collections: [], groups: [] };
  if (source.type === target.type && source.id === target.id) return { collections: [], groups: [] };

  const sourceUi = sourceCollection ? collectionUi(sourceCollection) : null;
  const members = new Map(model.groups.map((group) => [
    group.id,
    group.collections.filter((entry) => entry.collection !== sourceCollection?.collection),
  ]));
  const affectedGroups = new Set(sourceUi?.group ? [sourceUi.group] : []);
  let roots = model.nodes.filter((node) => !(
    node.type === source.type && node.id === source.id
  ));

  if (sourceCollection) {
    const sourceNode = {
      type: 'collection',
      id: sourceCollection.collection,
      sort: sourceUi.sort,
      entry: sourceCollection,
    };
    const targetCollection = target.type === 'collection'
      ? collections.find((entry) => !entry.system && entry.collection === target.id)
      : null;
    const targetGroup = targetCollection ? collectionUi(targetCollection).group : null;

    if (target.type === 'group' && target.position === 'inside' && members.has(target.id)) {
      members.get(target.id).push(sourceCollection);
      affectedGroups.add(target.id);
    } else if (targetCollection && targetGroup && members.has(targetGroup)) {
      const groupMembers = members.get(targetGroup);
      const targetIndex = groupMembers.findIndex((entry) => entry.collection === targetCollection.collection);
      groupMembers.splice(targetIndex + (target.position === 'after' ? 1 : 0), 0, sourceCollection);
      affectedGroups.add(targetGroup);
    } else if (target.type === 'collection' || target.type === 'group') {
      roots = insertRelative(roots, sourceNode, target, target.position);
    } else {
      roots.push(sourceNode);
    }
  } else {
    const sourceNode = {
      type: 'group',
      id: sourceGroup.id,
      sort: Number(sourceGroup.sort ?? 0),
      group: sourceGroup,
    };
    if (target.type === 'collection' || target.type === 'group') {
      roots = insertRelative(roots, sourceNode, target, target.position);
    } else {
      roots.push(sourceNode);
    }
  }

  const collectionPatches = [];
  const groupPatches = [];
  roots.forEach((node, index) => {
    const sort = (index + 1) * 10;
    if (node.type === 'group') {
      if (Number(node.group.sort ?? 0) !== sort) groupPatches.push({ id: node.id, sort });
      return;
    }
    const patch = changedCollectionPatch(node.entry, null, sort);
    if (patch) collectionPatches.push(patch);
  });

  for (const groupId of affectedGroups) {
    const groupMembers = members.get(groupId) ?? [];
    groupMembers.forEach((entry, index) => {
      const patch = changedCollectionPatch(entry, groupId, (index + 1) * 10);
      if (patch) collectionPatches.push(patch);
    });
  }

  return {
    collections: [...new Map(collectionPatches.map((patch) => [patch.collection, patch])).values()],
    groups: groupPatches,
  };
}

export function navigationAppendPatches(collections = [], groups = []) {
  const model = buildNavigationModel(collections, groups);
  const collectionPatches = [];
  const groupPatches = [];
  model.nodes.forEach((node, index) => {
    const sort = (index + 1) * 10;
    if (node.type === 'group') {
      if (Number(node.group.sort ?? 0) !== sort) groupPatches.push({ id: node.id, sort });
      return;
    }
    const patch = changedCollectionPatch(node.entry, null, sort);
    if (patch) collectionPatches.push(patch);
  });
  return {
    collections: collectionPatches,
    groups: groupPatches,
    sort: (model.nodes.length + 1) * 10,
  };
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
