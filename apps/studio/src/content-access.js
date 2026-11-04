import { readAllStudioPages } from './paged-data.js';

export function directContentRelations(collection, relations = []) {
  return relations.filter(relation => relation.many_collection === collection && relation.one_collection && relation.many_field);
}

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

export function translatedRelationLabel(rows = [], locale = 'en', fallback = '') {
  const language = String(locale).toLowerCase().split('-')[0];
  const label = row => row?.title || row?.name || row?.url || row?.slug || '';
  const matching = rows.find(row => String(row.languages_code || row.language_code || '').toLowerCase().split('-')[0] === language && label(row));
  return label(matching) || label(rows.find(row => label(row))) || fallback;
}

export async function loadRelationLookup(relation, { isAdmin = false, request, locale = 'en' } = {}) {
  const targetCollection = relation.one_collection;
  const keyField = relation.one_field || 'id';
  try {
    if (targetCollection === 'yuncms_users') {
      const items = await readAllStudioPages('/users', { request, keyField });
      return [relation.many_field, {
        targetCollection,
        keyField,
        labelField: 'email',
        items,
      }];
    }
    if (targetCollection === 'yuncms_files') {
      const items = (await readAllStudioPages('/files', { request, keyField })).map((item) => ({
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
      const items = await readAllStudioPages('/roles', { request, keyField });
      return [relation.many_field, {
        targetCollection,
        keyField,
        labelField: 'name',
        items,
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
    const [fieldResponse, itemRows] = await Promise.all([
      request(`${isAdmin ? '/schema' : '/studio-navigation'}/collections/${encodeURIComponent(targetCollection)}/fields`),
      readAllStudioPages(`/items/${encodeURIComponent(targetCollection)}`, { request, keyField }),
    ]);
    const targetFields = fieldResponse?.data ?? [];
    let labelField = pickDisplayField(targetFields, keyField);
    let items = itemRows;

    if ((labelField === keyField || labelField === 'status') && !String(targetCollection).endsWith('_translations')) {
      try {
        const transCollection = `${targetCollection}_translations`;
        const transRows = await readAllStudioPages(`/items/${encodeURIComponent(transCollection)}`, { request });
        const fkField = `${targetCollection}_id`;
        if (transRows.length > 0 && transRows.some((row) => Object.hasOwn(row, fkField))) {
          const byParent = new Map();
          for (const row of transRows) {
            const parentKey = String(row[fkField] ?? '');
            if (!parentKey) continue;
            const list = byParent.get(parentKey) ?? [];
            list.push(row);
            byParent.set(parentKey, list);
          }
          items = items.map((item) => {
            const rows = byParent.get(String(item?.[keyField])) ?? [];
            return {
              ...item,
              _translated_label: translatedRelationLabel(rows, locale, String(item?.[keyField] ?? '')),
            };
          });
          labelField = '_translated_label';
        }
      } catch (error) {
        if (error.code === 'STUDIO_PAGINATION_CHANGED') throw error;
        // Fallback to default labelField if no translations collection exists
      }
    }

    return [relation.many_field, {
      targetCollection,
      keyField,
      labelField,
      items,
    }];
  } catch (error) {
    if (error.code === 'STUDIO_PAGINATION_CHANGED') throw error;
    return [relation.many_field, {
      targetCollection,
      keyField,
      labelField: targetCollection === 'yuncms_users' ? 'email' : keyField,
      items: [],
    }];
  }
}
