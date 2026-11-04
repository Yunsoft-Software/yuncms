import { inputValueForField as defaultInputValueForField, outputValueForField as defaultOutputValueForField } from './content-field-values.js';
import { loadRelationLookup, primaryKeyFieldForFields } from './content-access.js';
import { editHeaders, editRequest } from './content-edit-state.js';
import { readAllStudioPages } from './paged-data.js';
import { isFileField, isReadOnlyField, isSystemManagedField } from './field-ui.js';

const TURKISH_CHAR_MAP = Object.freeze({
  ç: 'c', Ç: 'c',
  ğ: 'g', Ğ: 'g',
  ı: 'i', İ: 'i',
  ö: 'o', Ö: 'o',
  ş: 's', Ş: 's',
  ü: 'u', Ü: 'u',
  â: 'a', Â: 'a',
  î: 'i', Î: 'i',
  û: 'u', Û: 'u',
});

export function slugifyText(value = '', { preserveLeadingSlash = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const hasLeadingSlash = preserveLeadingSlash && raw.startsWith('/');
  const mapped = raw
    .split('')
    .map((ch) => TURKISH_CHAR_MAP[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!mapped) return '';
  return hasLeadingSlash ? `/${mapped}` : mapped;
}

export function parseRelationMeta(relation) {
  if (!relation?.metadata) return {};
  if (typeof relation.metadata === 'object') return relation.metadata;
  try {
    return JSON.parse(relation.metadata) ?? {};
  } catch {
    return {};
  }
}

function relationKind(relation) {
  return parseRelationMeta(relation).kind || 'm2o';
}

function sortLanguages(languages = []) {
  const priority = (code) => {
    const lower = String(code || '').toLowerCase();
    if (lower.startsWith('tr')) return 0;
    if (lower.startsWith('en')) return 1;
    return 2;
  };
  return [...languages].sort((a, b) => (
    priority(a.code) - priority(b.code)
    || String(a.code || '').localeCompare(String(b.code || ''))
  ));
}

export async function discoverNestedRelations(collection, relations = [], { isAdmin = false, request, locale = 'en' } = {}) {
  if (!collection || !Array.isArray(relations) || typeof request !== 'function') return [];

  const reverseRelations = relations.filter((rel) => rel.one_collection === collection);
  if (reverseRelations.length === 0) return [];

  const descriptors = [];
  const seenKeys = new Set();

  for (const rel of reverseRelations) {
    const meta = parseRelationMeta(rel);
    const kind = relationKind(rel);

    if (rel.junction_collection && kind === 'm2m') {
      const companion = relations.find((candidate) => (
        candidate.junction_collection === rel.junction_collection
        && candidate.many_collection === rel.junction_collection
        && candidate.many_field === rel.junction_field
        && candidate.one_collection !== collection
      ));
      if (!companion) continue;
      const key = `m2m:${rel.junction_collection}:${rel.many_field}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const [, lookup] = await loadRelationLookup(
        {
          many_collection: rel.junction_collection,
          many_field: companion.many_field,
          one_collection: companion.one_collection,
          one_field: companion.one_field || 'id',
        },
        { isAdmin, request, locale },
      );

      descriptors.push({
        key,
        kind: 'm2m',
        alias: meta.reverseField || companion.one_collection,
        junctionCollection: rel.junction_collection,
        sourceJunctionField: rel.many_field,
        targetJunctionField: rel.junction_field,
        targetCollection: companion.one_collection,
        targetKeyField: companion.one_field || 'id',
        lookup,
      });
      continue;
    }

    if (rel.junction_collection || kind === 'm2m' || rel.many_collection === collection) {
      continue;
    }

    const childCollection = rel.many_collection;
    const foreignKeyField = rel.many_field;
    const key = `o2m:${childCollection}:${foreignKeyField}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    try {
      const [fieldRes, capRes] = await Promise.all([
        request(`${isAdmin ? '/schema' : '/studio-navigation'}/collections/${encodeURIComponent(childCollection)}/fields`),
        request(`/studio-navigation/collections/${encodeURIComponent(childCollection)}/capabilities`),
      ]);
      const childFields = fieldRes?.data ?? [];
      const childCapabilities = capRes?.data ?? null;
      const primaryKey = primaryKeyFieldForFields(childFields);

      const languageRelation = relations.find((candidate) => (
        candidate.many_collection === childCollection
        && !candidate.junction_collection
        && candidate.one_collection === 'languages'
      ));
      const languageFieldObj = childFields.find((f) => (
        f.field === languageRelation?.many_field
        || f.field === 'languages_code'
        || f.field === 'language_code'
      ));
      const isTranslations = Boolean(
        languageFieldObj && (
          childCollection.endsWith('_translations')
          || meta.reverseField === 'translations'
          || languageRelation
        ),
      );

      const childDirectRelations = relations.filter((candidate) => (
        candidate.many_collection === childCollection
        && !candidate.junction_collection
        && relationKind(candidate) !== 'm2m'
        && candidate.many_field !== foreignKeyField
        && candidate.many_field !== languageFieldObj?.field
      ));
      const childLookupEntries = await Promise.all(
        childDirectRelations.map((candidate) => loadRelationLookup(candidate, { isAdmin, request, locale })),
      );
      const childRelationLookups = Object.fromEntries(childLookupEntries);

      if (isTranslations) {
        let languages = [
          { code: 'tr-TR', name: 'Türkçe', direction: 'ltr' },
          { code: 'en-US', name: 'English', direction: 'ltr' },
        ];
        try {
          const languageRows = await readAllStudioPages('/items/languages', { request, limit: 100 });
          if (languageRows.length > 0) {
            languages = sortLanguages(languageRows);
          }
        } catch (error) {
          if (error.code === 'STUDIO_PAGINATION_CHANGED') throw error;
          // keep fallback languages
        }

        const editableFields = childFields.filter((f) => (
          f.field !== primaryKey
          && f.field !== foreignKeyField
          && f.field !== languageFieldObj.field
          && !f.hidden
          && !isReadOnlyField(f)
          && !isSystemManagedField(f)
        ));

        descriptors.push({
          key: `translations:${childCollection}:${foreignKeyField}`,
          kind: 'translations',
          alias: meta.reverseField || 'translations',
          childCollection,
          primaryKey,
          foreignKeyField,
          languageField: languageFieldObj.field,
          languages,
          fields: childFields,
          editableFields,
          capabilities: childCapabilities,
          relationLookups: childRelationLookups,
        });
      } else {
        const editableFields = childFields.filter((f) => (
          f.field !== primaryKey
          && f.field !== foreignKeyField
          && !f.hidden
          && !isReadOnlyField(f)
          && !isSystemManagedField(f)
        ));

        descriptors.push({
          key,
          kind: 'o2m',
          alias: meta.reverseField || childCollection,
          childCollection,
          primaryKey,
          foreignKeyField,
          fields: childFields,
          editableFields,
          capabilities: childCapabilities,
          relationLookups: childRelationLookups,
        });
      }
    } catch (error) {
      if (error.code === 'STUDIO_PAGINATION_CHANGED') throw error;
      // Child collection not readable by current role; skip inline descriptor
    }
  }

  const orderWeight = (item) => (item.kind === 'translations' ? 0 : item.kind === 'm2m' ? 1 : 2);
  return descriptors.sort((a, b) => orderWeight(a) - orderWeight(b) || a.key.localeCompare(b.key));
}

export function nestedRelationsHaveFiles(nestedRelations = []) {
  return nestedRelations.some((rel) => (
    (rel.editableFields ?? []).some((field) => isFileField(field))
  ));
}

export function virtualRelationColumns(nestedRelations = [], t, collections = []) {
  return nestedRelations.map((rel) => {
    if (rel.kind === 'translations') {
      return {
        field: `__rel_${rel.key}`,
        name: t ? t('relations.translationSummary') : 'Translations',
        type: 'relation-virtual',
        virtualRelation: rel,
      };
    }
    return {
      field: `__rel_${rel.key}`,
      name: collections.find((entry) => entry.collection === (rel.targetCollection || rel.childCollection) && rel.alias === entry.collection)?.name || rel.alias,
      type: 'relation-virtual',
      virtualRelation: rel,
    };
  });
}

export async function loadNestedSummariesForItems(nestedRelations = [], items = [], { request } = {}) {
  if (!nestedRelations.length || !items.length || typeof request !== 'function') return {};
  const parentIds = items.map((item) => item?.id).filter((id) => id != null && id !== '');
  if (parentIds.length === 0) return {};

  const entries = await Promise.all(
    nestedRelations.map(async (rel) => {
      try {
        if (rel.kind === 'm2m') {
          const filter = JSON.stringify({ [rel.sourceJunctionField]: { _in: parentIds } });
          const rows = await readAllStudioPages(`/items/${encodeURIComponent(rel.junctionCollection)}?filter=${encodeURIComponent(filter)}`, { request });
          const grouped = {};
          for (const row of rows) {
            const parentKey = String(row[rel.sourceJunctionField] ?? '');
            if (!parentKey) continue;
            grouped[parentKey] ??= [];
            grouped[parentKey].push(row);
          }
          return [rel.key, grouped];
        }

        const filter = JSON.stringify({ [rel.foreignKeyField]: { _in: parentIds } });
        const rows = await readAllStudioPages(`/items/${encodeURIComponent(rel.childCollection)}?filter=${encodeURIComponent(filter)}`, { request });
        const grouped = {};
        for (const row of rows) {
          const parentKey = String(row[rel.foreignKeyField] ?? '');
          if (!parentKey) continue;
          grouped[parentKey] ??= [];
          grouped[parentKey].push(row);
        }
        return [rel.key, grouped];
      } catch (error) {
        if (error.code === 'STUDIO_PAGINATION_CHANGED') throw error;
        return [rel.key, {}];
      }
    }),
  );

  return Object.fromEntries(entries);
}

export async function searchNestedParentIds(nestedRelations = [], search = '', { request } = {}) {
  const query = String(search || '').trim();
  if (!query || !nestedRelations.length || typeof request !== 'function') return null;

  const searchableRelations = nestedRelations.filter(
    (rel) => (rel.kind === 'translations' || rel.kind === 'o2m')
      && (rel.editableFields ?? []).some((f) => ['string', 'text'].includes(f.type)),
  );
  if (searchableRelations.length === 0) return null;

  const matchedIds = new Set();
  await Promise.all(
    searchableRelations.map(async (rel) => {
      const textFields = rel.editableFields.filter((f) => ['string', 'text'].includes(f.type));
      const filter = JSON.stringify({
        _or: textFields.map((f) => ({ [f.field]: { _contains: query } })),
      });
      try {
        const rows = await readAllStudioPages(`/items/${encodeURIComponent(rel.childCollection)}?filter=${encodeURIComponent(filter)}`, { request });
        for (const row of rows) {
          const parentId = row?.[rel.foreignKeyField];
          if (parentId != null && parentId !== '') matchedIds.add(String(parentId));
        }
      } catch (error) {
        if (error.code === 'STUDIO_PAGINATION_CHANGED') throw error;
        // ignore child search error
      }
    }),
  );

  return [...matchedIds];
}

export async function loadNestedRecordRows(nestedRelations = [], recordId = null, { request } = {}) {
  if (!recordId || !nestedRelations.length || typeof request !== 'function') return {};

  request = editRequest(request);
  const entries = await Promise.all(
    nestedRelations.map(async (rel) => {
      if (rel.kind === 'm2m') {
        const filter = JSON.stringify({ [rel.sourceJunctionField]: { _eq: recordId } });
        const rows = await readAllStudioPages(`/items/${encodeURIComponent(rel.junctionCollection)}?filter=${encodeURIComponent(filter)}`, { request });
        return [rel.key, rows];
      }
      const filter = JSON.stringify({ [rel.foreignKeyField]: { _eq: recordId } });
      const rows = await readAllStudioPages(`/items/${encodeURIComponent(rel.childCollection)}?filter=${encodeURIComponent(filter)}`, { request });
      return [rel.key, rows];
    }),
  );

  return Object.fromEntries(entries);
}

export function buildInitialNestedDraft(nestedRelations = [], existingRowsByKey = {}, inputValueForField = defaultInputValueForField) {
  const draft = {};

  for (const rel of nestedRelations) {
    const existingRows = existingRowsByKey[rel.key] ?? [];

    if (rel.kind === 'translations') {
      const byLang = {};
      for (const lang of rel.languages) {
        const matched = existingRows.find((row) => String(row[rel.languageField]) === String(lang.code));
        const values = Object.fromEntries(
          rel.editableFields.map((field) => [field.field, inputValueForField(field, matched?.[field.field])]),
        );
        byLang[lang.code] = {
          id: matched?.[rel.primaryKey] ?? matched?.id ?? null,
          languageCode: lang.code,
          cleared: false,
          values,
        };
      }
      // Also preserve any existing rows with language codes not in rel.languages
      for (const row of existingRows) {
        const code = row[rel.languageField];
        if (!code || byLang[code]) continue;
        byLang[code] = {
          id: row[rel.primaryKey] ?? row.id ?? null,
          languageCode: code,
          cleared: false,
          values: Object.fromEntries(
            rel.editableFields.map((field) => [field.field, inputValueForField(field, row[field.field])]),
          ),
        };
      }
      draft[rel.key] = byLang;
    } else if (rel.kind === 'm2m') {
      draft[rel.key] = existingRows
        .map((row) => row[rel.targetJunctionField])
        .filter((val) => val != null && val !== '')
        .map(String);
    } else if (rel.kind === 'o2m') {
      draft[rel.key] = existingRows.map((row, idx) => ({
        _localId: `existing-${row[rel.primaryKey] ?? row.id ?? idx}`,
        id: row[rel.primaryKey] ?? row.id ?? null,
        deleted: false,
        values: Object.fromEntries(
          rel.editableFields.map((field) => [field.field, inputValueForField(field, row[field.field])]),
        ),
      }));
    }
  }

  return draft;
}

function hasAnyNonEmptyValue(values = {}) {
  return Object.values(values).some((val) => {
    if (val == null) return false;
    if (typeof val === 'boolean') return val === true;
    return String(val).trim() !== '';
  });
}

export async function saveNestedRelations({
  nestedRelations = [],
  parentId,
  existingRowsByKey = {},
  draftState = {},
  request,
  outputValueForField = defaultOutputValueForField,
  onProgress,
}) {
  if (!parentId || !nestedRelations.length || typeof request !== 'function') return;

  // Keep confirmed progress when a later child fails. Retrying must neither
  // create duplicate children nor reuse stale tokens for completed writes.
  draftState = structuredClone(draftState);
  existingRowsByKey = Object.fromEntries(Object.entries(existingRowsByKey).map(([key, rows]) => [key, [...rows]]));
  const perform = async (rel, method, id, body, entry = null) => {
    const target = rel.kind === 'm2m' ? rel.junctionCollection : rel.childCollection;
    const rows = existingRowsByKey[rel.key] ?? [];
    const pk = rel.primaryKey ?? 'id';
    const previous = rows.find(row => String(row[pk] ?? row.id) === String(id));
    const response = await editRequest(request)(`/items/${encodeURIComponent(target)}${id == null ? '' : `/${encodeURIComponent(id)}`}`, {
      method, ...(body ? { body } : {}), headers: editHeaders(previous),
    });
    if (method === 'DELETE') {
      existingRowsByKey[rel.key] = rows.filter(row => row !== previous);
      if (entry) entry.id = null;
    } else if (response?.data) {
      const saved = response.data;
      existingRowsByKey[rel.key] = [...rows.filter(row => row !== previous), saved];
      if (entry) entry.id = saved[pk] ?? saved.id;
    }
    onProgress?.({ draftState, existingRowsByKey });
    return response;
  };
  for (const rel of nestedRelations) {
    const existingRows = existingRowsByKey[rel.key] ?? [];
    const relDraft = draftState[rel.key];
    if (!relDraft) continue;

    if (rel.kind === 'translations') {
      for (const [langCode, entry] of Object.entries(relDraft)) {
        if (entry.cleared && entry.id != null) {
          await perform(rel, 'DELETE', entry.id, null, entry);
          continue;
        }
        if (entry.cleared || !hasAnyNonEmptyValue(entry.values)) {
          continue;
        }
        const payload = Object.fromEntries(
          rel.editableFields.map((field) => [
            field.field,
            outputValueForField(field, entry.values[field.field]),
          ]),
        );

        if (entry.id != null) {
          await perform(rel, 'PATCH', entry.id, payload, entry);
        } else {
          await perform(rel, 'POST', null, { [rel.foreignKeyField]: parentId, [rel.languageField]: langCode, ...payload }, entry);
        }
      }
    } else if (rel.kind === 'm2m') {
      const selectedTargetIds = new Set((Array.isArray(relDraft) ? relDraft : []).map(String));
      const existingByTarget = new Map();
      for (const row of existingRows) {
        const targetId = String(row[rel.targetJunctionField] ?? '');
        if (!targetId) continue;
        const list = existingByTarget.get(targetId) ?? [];
        list.push(row);
        existingByTarget.set(targetId, list);
      }

      // Delete unselected junction rows
      for (const [targetId, rows] of existingByTarget.entries()) {
        if (!selectedTargetIds.has(targetId)) {
          for (const row of rows) {
            if (row.id != null) {
              await perform(rel, 'DELETE', row.id);
            }
          }
        }
      }

      // Create newly selected junction rows
      for (const targetId of selectedTargetIds) {
        if (!existingByTarget.has(targetId)) {
          await perform(rel, 'POST', null, { [rel.sourceJunctionField]: parentId, [rel.targetJunctionField]: targetId });
        }
      }
    } else if (rel.kind === 'o2m') {
      const items = Array.isArray(relDraft) ? relDraft : [];
      for (const item of items) {
        if (item.deleted) {
          if (item.id != null) {
            await perform(rel, 'DELETE', item.id, null, item);
          }
          continue;
        }
        if (!hasAnyNonEmptyValue(item.values) && item.id == null) {
          continue;
        }
        const payload = Object.fromEntries(
          rel.editableFields.map((field) => [
            field.field,
            outputValueForField(field, item.values[field.field]),
          ]),
        );
        if (item.id != null) {
          await perform(rel, 'PATCH', item.id, payload, item);
        } else {
          await perform(rel, 'POST', null, { [rel.foreignKeyField]: parentId, ...payload }, item);
        }
      }
    }
  }
  return { draftState, existingRowsByKey };
}
