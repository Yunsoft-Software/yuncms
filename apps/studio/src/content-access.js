export function canWriteContent(capabilities, action, recordId = null) {
  if (capabilities?.[action]?.allowed !== true) return false;
  return action === 'create' || (recordId !== null && Object.hasOwn(capabilities.records ?? {}, String(recordId)) && capabilities.records[String(recordId)][action] === true);
}

export function contentWritableFields(fields, capabilities, action, readonly) {
  if (capabilities?.[action]?.allowed !== true) return [];
  const allowed = capabilities[action].fields;
  return fields.filter(field => !readonly(field) && (allowed === null || allowed?.includes(field.field)));
}

export function contentRecordValuesKey(record, fields) {
  return JSON.stringify([record?.id ?? null, ...fields.map(field => [field.field, field.type ?? null, record?.[field.field] ?? null])]);
}

export function pickDisplayField(fields, keyField = 'id') {
  const visible = (fields ?? []).filter((field) => !field.hidden);
  for (const preferred of ['name', 'title', 'label']) {
    const match = visible.find((field) => field.field === preferred);
    if (match) return match.field;
  }
  const textual = visible.find((field) => ['string', 'text'].includes(field.type) && field.field !== keyField);
  return textual?.field ?? keyField;
}

export function primaryKeyFieldForFields(fields = []) {
  for (const field of fields) {
    const meta = typeof field?.schema_metadata === 'string'
      ? (() => { try { return JSON.parse(field.schema_metadata); } catch { return {}; } })()
      : (field?.schema_metadata ?? {});
    if (meta?.primaryKey === true && field?.field) return field.field;
  }
  return 'id';
}

export function normalizeRecordPrimaryKey(record, primaryKey = 'id') {
  if (!record || typeof record !== 'object') return record;
  if (record.id !== undefined || primaryKey === 'id' || record[primaryKey] === undefined) return record;
  return { ...record, id: record[primaryKey] };
}

export async function loadRelationLookup(relation, { isAdmin = false, request } = {}) {
  const targetCollection = relation.one_collection;
  const keyField = relation.one_field || 'id';
  try {
    if (targetCollection === 'yuncms_users') {
      const itemResponse = await request('/users?limit=200');
      return [relation.many_field, {
        targetCollection,
        keyField,
        labelField: 'email',
        items: itemResponse?.data ?? [],
      }];
    }
    if (targetCollection === 'yuncms_files') {
      const itemResponse = await request('/files?limit=200');
      const items = (itemResponse?.data ?? []).map((item) => ({
        ...item,
        title: item?.title || item?.filename_download || item?.[keyField],
      }));
      return [relation.many_field, {
        targetCollection,
        keyField,
        labelField: 'title',
        items,
      }];
    }
    if (targetCollection === 'yuncms_roles') {
      const itemResponse = await request('/roles?limit=200');
      return [relation.many_field, {
        targetCollection,
        keyField,
        labelField: 'name',
        items: itemResponse?.data ?? [],
      }];
    }
    if (String(targetCollection).startsWith('yuncms_')) {
      return [relation.many_field, {
        targetCollection,
        keyField,
        labelField: keyField,
        items: [],
      }];
    }
    const [fieldResponse, itemResponse] = await Promise.all([
      request(`${isAdmin ? '/schema' : '/studio-navigation'}/collections/${encodeURIComponent(targetCollection)}/fields`),
      request(`/items/${encodeURIComponent(targetCollection)}?limit=200`),
    ]);
    const targetFields = fieldResponse?.data ?? [];
    return [relation.many_field, {
      targetCollection,
      keyField,
      labelField: pickDisplayField(targetFields, keyField),
      items: itemResponse?.data ?? [],
    }];
  } catch {
    return [relation.many_field, {
      targetCollection,
      keyField,
      labelField: targetCollection === 'yuncms_users' ? 'email' : keyField,
      items: [],
    }];
  }
}
