export function contentEmptyState(visibleCollectionCount = 0) {
  const selectable = visibleCollectionCount > 0;
  return {
    title: selectable ? 'content.selectCollection' : 'content.noCollections',
    description: selectable ? 'content.selectCollectionDescription' : 'content.noCollectionsDescription',
    canCreateCollection: !selectable,
  };
}
