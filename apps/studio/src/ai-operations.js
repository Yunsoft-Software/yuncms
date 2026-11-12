const OPERATION_KEYS = Object.freeze({
  schema_list_collections: 'ai.operationCollections',
  schema_describe_collection: 'ai.operationSchema',
  items_read_many: 'ai.operationReadMany',
  items_read_one: 'ai.operationReadOne',
  items_create: 'ai.operationCreate',
  items_update: 'ai.operationUpdate',
  items_delete: 'ai.operationDelete',
});

const MUTATION_KEYS = Object.freeze({
  items_create: 'ai.mutationCreate',
  items_update: 'ai.mutationUpdate',
  items_delete: 'ai.mutationDelete',
});

export function operationText(operation, t) {
  const key = OPERATION_KEYS[operation?.operation] ?? 'ai.operationGeneric';
  return t(key, { collection: operation?.collection || t('ai.operationData') });
}

export function mutationText(mutation, t) {
  const key = MUTATION_KEYS[mutation?.operation];
  if (!key) return '';
  return t(key, {
    collection: mutation?.collection || t('ai.operationData'),
    id: mutation?.id ?? '—',
  });
}
