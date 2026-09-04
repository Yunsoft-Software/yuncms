import { useEffect, useMemo, useRef, useState } from 'react';

import { apiRequest } from '../api.js';
import {
  DataViewOptions,
  FileFieldControl,
  FileValuePreview,
  Inspector,
  Pagination,
  RelationPicker,
  useConfirmDialog,
} from '../components/index.js';
import { contentTableFields, isFileField, isImageField } from '../field-ui.js';
import { useI18n } from '../i18n.js';
import { displaySchemaName } from '../schema-name.js';
import { studioPath } from '../studio-route.js';

const PAGE_SIZES = [25, 50, 100];

const TEXT_OPERATORS = [
  ['_contains', 'content.opContains'],
  ['_starts_with', 'content.opStartsWith'],
  ['_ends_with', 'content.opEndsWith'],
  ['_eq', 'content.opExactly'],
  ['_neq', 'content.opNot'],
  ['_null', 'content.opEmpty'],
  ['_nnull', 'content.opNotEmpty'],
];

const ORDER_OPERATORS = [
  ['_eq', 'content.opEquals'],
  ['_neq', 'content.opDoesNotEqual'],
  ['_gt', 'content.opGreaterThan'],
  ['_gte', 'content.opGreaterEqual'],
  ['_lt', 'content.opLessThan'],
  ['_lte', 'content.opLessEqual'],
  ['_null', 'content.opEmpty'],
  ['_nnull', 'content.opNotEmpty'],
];

const BOOLEAN_OPERATORS = [
  ['_eq', 'content.opIs'],
  ['_null', 'content.opEmpty'],
  ['_nnull', 'content.opNotEmpty'],
];

const UUID_OPERATORS = [
  ['_eq', 'content.opIs'],
  ['_neq', 'content.opNot'],
  ['_null', 'content.opEmpty'],
  ['_nnull', 'content.opNotEmpty'],
];

function fieldLabel(field) {
  return displaySchemaName(field, 'field');
}

function inputValueForField(field, value) {
  if (value == null) return field.type === 'boolean' ? false : '';
  if (field.type === 'json') return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (field.type === 'boolean') return Boolean(value);
  if (field.type === 'datetime' || field.type === 'timestamp') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 16);
  }
  return String(value);
}

function outputValueForField(field, value) {
  if (value === '' && !field.required) return null;
  if (field.type === 'boolean') return Boolean(value);
  if (field.type === 'integer' || field.type === 'bigint') return Number.parseInt(value, 10);
  if (field.type === 'decimal') return Number(value);
  if (field.type === 'json') {
    if (value === '') return null;
    return JSON.parse(value);
  }
  return value;
}

function relationKind(relation) {
  if (!relation?.metadata) return 'm2o';
  if (typeof relation.metadata === 'object') return relation.metadata.kind || 'm2o';
  try {
    return JSON.parse(relation.metadata)?.kind || 'm2o';
  } catch {
    return 'm2o';
  }
}

function pickDisplayField(fields, keyField = 'id') {
  const visible = fields.filter((field) => !field.hidden);
  for (const preferred of ['name', 'title', 'label']) {
    const match = visible.find((field) => field.field === preferred);
    if (match) return match.field;
  }
  const textual = visible.find((field) => ['string', 'text'].includes(field.type) && field.field !== keyField);
  return textual?.field ?? keyField;
}

function lookupLabel(lookup, value) {
  if (value == null || value === '') return '—';
  if (!lookup) return String(value);
  const item = lookup.items.find((entry) => String(entry[lookup.keyField]) === String(value));
  if (!item) return String(value);
  const label = item[lookup.labelField];
  return label == null || label === '' ? String(value) : String(label);
}

function renderValue(field, record, relationLookups, t, locale) {
  const value = record[field.field];
  const lookup = relationLookups[field.field];
  if (lookup) return lookupLabel(lookup, value);
  if (value == null || value === '') return <span className="content-value-empty">—</span>;
  if (field.type === 'boolean') {
    return (
      <span className={`content-value-boolean ${value ? 'is-true' : 'is-false'}`}>
        <span aria-hidden="true">{value ? '✓' : '—'}</span>
        {t(value ? 'common.yes' : 'common.no')}
      </span>
    );
  }
  if (['date', 'datetime', 'timestamp'].includes(field.type)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      const formatter = new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', field.type === 'date'
        ? { dateStyle: 'medium' }
        : { dateStyle: 'medium', timeStyle: 'short' });
      return <time className="content-value-date" dateTime={date.toISOString()}>{formatter.format(date)}</time>;
    }
  }
  if (field.field === 'status' || field.field.endsWith('_status')) {
    return <span className="content-value-status">{String(value)}</span>;
  }
  if (typeof value === 'object') return <code className="content-value-json">{JSON.stringify(value)}</code>;
  return String(value);
}

function operatorsForField(field, relationLookup) {
  if (relationLookup || isFileField(field)) return UUID_OPERATORS;
  if (['string', 'text'].includes(field?.type)) return TEXT_OPERATORS;
  if (field?.type === 'boolean') return BOOLEAN_OPERATORS;
  if (['integer', 'bigint', 'decimal', 'date', 'datetime', 'timestamp'].includes(field?.type)) return ORDER_OPERATORS;
  return UUID_OPERATORS;
}

function normalizeFilterValue(field, operator, value) {
  if (operator === '_null' || operator === '_nnull') return true;
  if (field?.type === 'boolean') return value === 'true';
  if (field?.type === 'integer' || field?.type === 'bigint') return Number.parseInt(value, 10);
  if (field?.type === 'decimal') return Number(value);
  return value;
}

function fieldInputType(field) {
  if (['integer', 'bigint', 'decimal'].includes(field?.type)) return 'number';
  if (field?.type === 'date') return 'date';
  if (['datetime', 'timestamp'].includes(field?.type)) return 'datetime-local';
  return 'text';
}

function buildItemsPath({ collection, fields, search, filters, sortField, sortDirection, limit, offset }) {
  const clauses = filters.map((entry) => ({
    [entry.field]: { [entry.operator]: entry.value },
  }));
  const searchFields = fields.filter((field) => !field.hidden && ['string', 'text'].includes(field.type));
  if (search && searchFields.length > 0) {
    clauses.push({
      _or: searchFields.map((field) => ({ [field.field]: { _contains: search } })),
    });
  }

  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (sortField) params.set('sort', `${sortDirection === 'desc' ? '-' : ''}${sortField}`);
  if (clauses.length === 1) params.set('filter', JSON.stringify(clauses[0]));
  if (clauses.length > 1) params.set('filter', JSON.stringify({ _and: clauses }));
  return `/items/${encodeURIComponent(collection)}?${params.toString()}`;
}

function RecordForm({
  collection,
  collectionLabel,
  fields,
  relationLookups,
  files,
  record,
  onFileUploaded,
  onSaved,
  onCancel,
  onOpenFull,
  compact = false,
}) {
  const { t } = useI18n();
  const editable = useMemo(() => fields.filter((field) => !field.readonly), [fields]);
  const [values, setValues] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValues(Object.fromEntries(editable.map((field) => [
      field.field,
      inputValueForField(field, record?.[field.field]),
    ])));
    setError('');
  }, [editable, record]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = Object.fromEntries(editable.map((field) => [
        field.field,
        outputValueForField(field, values[field.field]),
      ]));
      const path = record?.id
        ? `/items/${encodeURIComponent(collection)}/${encodeURIComponent(record.id)}`
        : `/items/${encodeURIComponent(collection)}`;
      const result = await apiRequest(path, {
        method: record?.id ? 'PATCH' : 'POST',
        body: payload,
      });
      onSaved(result?.data ?? null);
    } catch (requestError) {
      setError(requestError.message || t('content.saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={`panel form-panel record-editor ${compact ? 'record-editor-compact' : ''}`} onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{record?.id ? t('content.editRecord') : t('content.newRecord')}</p>
          <h2>{collectionLabel || collection}</h2>
          {collectionLabel && collectionLabel !== collection && <code className="schema-machine-key">{collection}</code>}
          <p>{record?.id ? t('content.updateDescription') : t('content.createDescription')}</p>
        </div>
        <button className="text-button" type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>

      <div className="form-grid record-form-grid">
        {editable.map((field) => {
          const relationLookup = relationLookups[field.field];
          const currentValue = values[field.field] ?? '';
          const label = fieldLabel(field);

          return (
            <label className={`field-label ${isFileField(field) ? 'file-field-label' : ''}`} key={field.field}>
              <span>{label}{field.required ? ' *' : ''}</span>
              {label !== field.field && <small className="field-api-key">{field.field}</small>}
              {isFileField(field) ? (
                <FileFieldControl
                  field={field}
                  value={currentValue}
                  files={files}
                  t={t}
                  onFileUploaded={onFileUploaded}
                  onChange={(value) => setValues((current) => ({ ...current, [field.field]: value }))}
                />
              ) : relationLookup ? (
                <RelationPicker
                  value={currentValue}
                  items={relationLookup.items}
                  keyField={relationLookup.keyField}
                  labelField={relationLookup.labelField}
                  required={Boolean(field.required)}
                  placeholder={field.required ? t('content.select') : t('common.none')}
                  searchPlaceholder={t('content.relationSearch')}
                  emptyLabel={t('content.relationEmpty')}
                  noneLabel={t('common.none')}
                  onChange={(value) => setValues((current) => ({ ...current, [field.field]: value }))}
                />
              ) : field.type === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={Boolean(values[field.field])}
                  onChange={(event) => setValues((current) => ({ ...current, [field.field]: event.target.checked }))}
                />
              ) : field.type === 'text' || field.type === 'json' ? (
                <textarea
                  rows={field.type === 'json' ? 6 : 4}
                  value={values[field.field] ?? ''}
                  onChange={(event) => setValues((current) => ({ ...current, [field.field]: event.target.value }))}
                  required={Boolean(field.required)}
                />
              ) : (
                <input
                  type={fieldInputType(field)}
                  step={field.type === 'decimal' ? 'any' : undefined}
                  value={values[field.field] ?? ''}
                  onChange={(event) => setValues((current) => ({ ...current, [field.field]: event.target.value }))}
                  required={Boolean(field.required)}
                />
              )}
              {relationLookup && (
                <small>{t('content.relationHint', {
                  collection: relationLookup.targetCollection,
                  field: relationLookup.labelField,
                })}</small>
              )}
            </label>
          );
        })}
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="form-actions">
        {compact && onOpenFull && (
          <button className="secondary-button" type="button" onClick={onOpenFull}>
            {t('content.openFullEditor')}
          </button>
        )}
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? t('common.saving') : t('content.saveRecord')}
        </button>
      </div>
    </form>
  );
}

export function ContentScreen({ collection, collectionLabel = '', onOpenDataModel, route = {}, onNavigate }) {
  const { locale, t } = useI18n();
  const requestConfirmation = useConfirmDialog();
  const requestVersion = useRef(0);
  const schemaLoadingRef = useRef(true);
  const [fields, setFields] = useState([]);
  const [relationLookups, setRelationLookups] = useState({});
  const [files, setFiles] = useState([]);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [inspectedRecord, setInspectedRecord] = useState(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState(() => new Set());
  const [visibleColumnKeys, setVisibleColumnKeys] = useState([]);
  const [density, setDensity] = useState('comfortable');
  const [loadedRecordKey, setLoadedRecordKey] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState([]);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState({ field: '', operator: '_contains', value: '' });
  const [sortField, setSortField] = useState('');
  const [sortDirection, setSortDirection] = useState('asc');
  const [pageSize, setPageSize] = useState(25);
  const [offset, setOffset] = useState(0);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const creating = route.view === 'new';
  const editing = route.view === 'record' ? editingRecord : null;
  const routeRecordKey = route.view === 'record' ? `${collection}:${route.recordId}` : '';

  async function buildRelationLookups(target, relations) {
    const directRelations = relations.filter((relation) =>
      relation.many_collection === target
      && !relation.junction_collection
      && relationKind(relation) !== 'm2m');

    const entries = await Promise.all(directRelations.map(async (relation) => {
      const targetCollection = relation.one_collection;
      const keyField = relation.one_field || 'id';
      const [fieldResponse, itemResponse] = await Promise.all([
        apiRequest(`/schema/collections/${encodeURIComponent(targetCollection)}/fields`),
        apiRequest(`/items/${encodeURIComponent(targetCollection)}?limit=200`),
      ]);
      const targetFields = fieldResponse?.data ?? [];
      return [relation.many_field, {
        targetCollection,
        keyField,
        labelField: pickDisplayField(targetFields, keyField),
        items: itemResponse?.data ?? [],
      }];
    }));

    return Object.fromEntries(entries);
  }

  async function loadCollectionSchema(target = collection) {
    const version = ++requestVersion.current;
    schemaLoadingRef.current = true;
    setFields([]);
    setRelationLookups({});
    setFiles([]);
    setItems([]);
    setMeta(null);
    setItemsLoading(false);
    if (!target) {
      schemaLoadingRef.current = false;
      setSchemaLoading(false);
      return;
    }
    setSchemaLoading(true);
    setError('');
    try {
      const [fieldResponse, relationResponse] = await Promise.all([
        apiRequest(`/schema/collections/${encodeURIComponent(target)}/fields`),
        apiRequest('/schema/relations'),
      ]);
      const loadedFields = fieldResponse?.data ?? [];
      const loadedRelations = relationResponse?.data ?? [];
      const [lookups, fileResponse] = await Promise.all([
        buildRelationLookups(target, loadedRelations),
        loadedFields.some(isFileField) ? apiRequest('/files') : Promise.resolve({ data: [] }),
      ]);
      if (version !== requestVersion.current) return;
      setFields(loadedFields);
      setRelationLookups(lookups);
      setFiles(fileResponse?.data ?? []);
    } catch (requestError) {
      if (version !== requestVersion.current) return;
      setError(requestError.message || t('content.schemaLoadError'));
    } finally {
      if (version === requestVersion.current) {
        schemaLoadingRef.current = false;
        setSchemaLoading(false);
      }
    }
  }

  async function loadItems(target = collection, targetFields = fields) {
    if (!target || targetFields.length === 0) return;
    const version = ++requestVersion.current;
    setItemsLoading(true);
    setError('');
    try {
      const path = buildItemsPath({
        collection: target,
        fields: targetFields,
        search,
        filters,
        sortField,
        sortDirection,
        limit: pageSize,
        offset,
      });
      const response = await apiRequest(path);
      if (version !== requestVersion.current) return;
      const nextItems = response?.data ?? [];
      setItems(nextItems);
      setMeta(response?.meta ?? null);
      setSelectedRecordIds(new Set());
      setInspectedRecord((current) => {
        if (!current) return null;
        return nextItems.find((record) => String(record.id) === String(current.id)) ?? current;
      });
    } catch (requestError) {
      if (version !== requestVersion.current) return;
      setError(requestError.message || t('content.dataLoadError'));
    } finally {
      if (version === requestVersion.current) setItemsLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setEditingRecord(null);
    setInspectedRecord(null);
    setSelectedRecordIds(new Set());
    setVisibleColumnKeys([]);
    setSearchInput('');
    setSearch('');
    setFilters([]);
    setMobileFiltersOpen(false);
    setFilterDraft({ field: '', operator: '_contains', value: '' });
    setSortField('');
    setSortDirection('asc');
    setOffset(0);
    setNotice('');
    loadCollectionSchema(collection);
  }, [collection]);

  useEffect(() => {
    if (route.view !== 'record' || !collection || !route.recordId) {
      return;
    }
    const requestKey = `${collection}:${route.recordId}`;
    let cancelled = false;
    setError('');
    apiRequest(`/items/${encodeURIComponent(collection)}/${encodeURIComponent(route.recordId)}`)
      .then((response) => { if (!cancelled) setEditingRecord(response?.data ?? null); })
      .catch((requestError) => {
        if (!cancelled) {
          setEditingRecord(null);
          setError(requestError.message || t('content.dataLoadError'));
        }
      })
      .finally(() => { if (!cancelled) setLoadedRecordKey(requestKey); });
    return () => { cancelled = true; };
  }, [collection, route.recordId, route.view]);

  useEffect(() => {
    if (!collection || schemaLoading || schemaLoadingRef.current || fields.length === 0) return;
    loadItems(collection, fields);
  }, [collection, fields, filters, offset, pageSize, schemaLoading, search, sortDirection, sortField]);

  async function removeRecord(record) {
    if (!record?.id) return;
    const accepted = await requestConfirmation({
      title: t('content.deleteRecord'),
      description: t('content.deleteRecordDescription', { id: record.id, collection: collectionLabel || collection }),
      confirmLabel: t('content.deleteRecordAction'),
      tone: 'danger',
    });
    if (!accepted) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(
        `/items/${encodeURIComponent(collection)}/${encodeURIComponent(record.id)}`,
        { method: 'DELETE' },
      );
      if (String(inspectedRecord?.id) === String(record.id)) setInspectedRecord(null);
      if (items.length === 1 && offset > 0) {
        setOffset(Math.max(0, offset - pageSize));
      } else {
        await loadItems();
      }
    } catch (requestError) {
      setError(requestError.message || t('content.deleteError'));
    }
  }

  async function removeSelectedRecords() {
    const selected = items.filter((record) => selectedRecordIds.has(String(record.id)));
    if (selected.length === 0) return;
    const accepted = await requestConfirmation({
      title: t('content.bulkDeleteTitle'),
      description: t('content.bulkDeleteDescription', {
        count: selected.length,
        collection: collectionLabel || collection,
      }),
      confirmLabel: t('content.bulkDelete'),
      tone: 'danger',
    });
    if (!accepted) return;

    setError('');
    setNotice('');
    const results = await Promise.allSettled(selected.map((record) => apiRequest(
      `/items/${encodeURIComponent(collection)}/${encodeURIComponent(record.id)}`,
      { method: 'DELETE' },
    )));
    const failed = results.filter((result) => result.status === 'rejected').length;
    setSelectedRecordIds(new Set());
    if (inspectedRecord && selected.some((record) => String(record.id) === String(inspectedRecord.id))) {
      setInspectedRecord(null);
    }
    if (failed > 0) {
      setError(t('content.bulkDeletePartial', { failed, count: selected.length }));
    } else {
      setNotice(t('content.bulkDeleteSuccess', { count: selected.length }));
    }
    if (failed === 0 && selected.length === items.length && offset > 0) {
      setOffset(Math.max(0, offset - pageSize));
    } else {
      await loadItems();
    }
  }

  const tableFields = useMemo(() => contentTableFields(fields), [fields]);
  useEffect(() => {
    setVisibleColumnKeys(tableFields.map((field) => field.field));
  }, [tableFields]);
  const visibleTableFields = useMemo(
    () => tableFields.filter((field) => visibleColumnKeys.includes(field.field)),
    [tableFields, visibleColumnKeys],
  );
  const mobileRecordFields = useMemo(() => {
    const preferred = visibleTableFields.filter((field) => field.field !== 'id');
    return (preferred.length > 0 ? preferred : visibleTableFields).slice(0, 4);
  }, [visibleTableFields]);
  const filterableFields = useMemo(() => fields.filter((field) => !field.hidden && field.type !== 'json'), [fields]);
  const selectedFilterField = filterableFields.find((field) => field.field === filterDraft.field) ?? null;
  const filterOperators = operatorsForField(selectedFilterField, relationLookups[filterDraft.field]);
  const hasTextSearch = fields.some((field) => !field.hidden && ['string', 'text'].includes(field.type));
  const totalCount = Number(meta?.total_count ?? 0);
  const currentPage = Math.floor(offset / pageSize) + 1;
  const hasActiveControls = Boolean(search || filters.length > 0 || sortField);
  const selectedCount = selectedRecordIds.size;
  const allPageSelected = items.length > 0 && items.every((record) => selectedRecordIds.has(String(record.id)));

  function toggleRecordSelection(recordId) {
    const key = String(recordId);
    setSelectedRecordIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function togglePageSelection() {
    setSelectedRecordIds(allPageSelected
      ? new Set()
      : new Set(items.map((record) => String(record.id))));
  }

  function toggleVisibleColumn(fieldKey) {
    setVisibleColumnKeys((current) => {
      if (current.includes(fieldKey)) {
        if (current.length <= 1) return current;
        return current.filter((key) => key !== fieldKey);
      }
      return [...current, fieldKey];
    });
  }

  function updateFilterField(fieldName) {
    const field = filterableFields.find((entry) => entry.field === fieldName) ?? null;
    const operators = operatorsForField(field, relationLookups[fieldName]);
    setFilterDraft({ field: fieldName, operator: operators[0]?.[0] || '_eq', value: '' });
  }

  function addFilter(event) {
    event.preventDefault();
    if (!selectedFilterField || !filterDraft.operator) return;
    const needsValue = !['_null', '_nnull'].includes(filterDraft.operator);
    if (needsValue && filterDraft.value === '') return;
    const value = normalizeFilterValue(selectedFilterField, filterDraft.operator, filterDraft.value);
    setFilters((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        field: selectedFilterField.field,
        operator: filterDraft.operator,
        value,
      },
    ]);
    setFilterDraft((current) => ({ ...current, value: '' }));
    setOffset(0);
  }

  function removeFilter(id) {
    setFilters((current) => current.filter((entry) => entry.id !== id));
    setOffset(0);
  }

  function clearControls() {
    setSearchInput('');
    setSearch('');
    setFilters([]);
    setMobileFiltersOpen(false);
    setSortField('');
    setSortDirection('asc');
    setOffset(0);
  }

  function toggleColumnSort(fieldName) {
    setOffset(0);
    if (sortField !== fieldName) {
      setSortField(fieldName);
      setSortDirection('asc');
      return;
    }
    if (sortDirection === 'asc') {
      setSortDirection('desc');
      return;
    }
    setSortField('');
    setSortDirection('asc');
  }

  function filterValueLabel(filter) {
    if (filter.operator === '_null') return t('content.empty');
    if (filter.operator === '_nnull') return t('content.notEmpty');
    const field = filterableFields.find((entry) => entry.field === filter.field);
    if (isFileField(field)) {
      const file = files.find((entry) => String(entry.id) === String(filter.value));
      return file?.title || file?.filename_download || String(filter.value);
    }
    const lookup = relationLookups[filter.field];
    return lookup ? lookupLabel(lookup, filter.value) : String(filter.value);
  }

  function filterFieldLabel(fieldKey) {
    const field = filterableFields.find((entry) => entry.field === fieldKey);
    return field ? fieldLabel(field) : fieldKey;
  }

  function registerUploadedFile(file) {
    setFiles((current) => [file, ...current.filter((entry) => entry.id !== file.id)]);
  }

  const visibleCollectionName = collectionLabel || collection;

  if (route.view === 'record' && loadedRecordKey !== routeRecordKey) {
    return <section className="panel"><p>{t('common.loading')}</p></section>;
  }

  if (route.view === 'record' && !editingRecord) {
    return (
      <div className="routed-form-page">
        <nav className="page-breadcrumbs" aria-label={visibleCollectionName}><button type="button" onClick={() => onNavigate?.(studioPath.content(collection))}>{visibleCollectionName}</button><span aria-hidden="true">/</span><strong>{t('content.recordNotFound')}</strong></nav>
        <section className="panel empty-state empty-state-action"><div><h2>{t('content.recordNotFound')}</h2><p>{t('content.recordNotFoundDescription')}</p></div><button className="secondary-button" type="button" onClick={() => onNavigate?.(studioPath.content(collection))}>{t('common.back')}</button></section>
        {error && <div className="error-banner" role="alert">{error}</div>}
      </div>
    );
  }

  if (creating || editing) {
    return (
      <div className="routed-form-page">
        <nav className="page-breadcrumbs" aria-label={visibleCollectionName}><button type="button" onClick={() => onNavigate?.(studioPath.content(collection))}>{visibleCollectionName}</button><span aria-hidden="true">/</span><strong>{creating ? t('content.createRecord') : t('content.editRecord')}</strong></nav>
        <RecordForm
          collection={collection}
          collectionLabel={collectionLabel}
          fields={fields}
          relationLookups={relationLookups}
          files={files}
          record={editing}
          onFileUploaded={registerUploadedFile}
          onCancel={() => onNavigate?.(studioPath.content(collection))}
          onSaved={async () => {
            await loadItems();
            onNavigate?.(studioPath.content(collection));
          }}
        />
      </div>
    );
  }

  if (!collection) {
    return (
      <section className="panel empty-state empty-state-action">
        <div>
          <p className="eyebrow">{t('nav.content')}</p>
          <h2>{t('content.noCollections')}</h2>
          <p>{t('content.noCollectionsDescription')}</p>
        </div>
        {onOpenDataModel && (
          <button className="primary-button" type="button" onClick={onOpenDataModel}>{t('content.openDataModel')}</button>
        )}
      </section>
    );
  }

  return (
    <div className="screen-stack">
      <section className="panel toolbar-panel content-toolbar">
        <div>
          <p className="eyebrow">{t('visibility.collection')}</p>
          <h2>{visibleCollectionName}</h2>
          {visibleCollectionName !== collection && <code className="schema-machine-key">{collection}</code>}
          <p>{meta?.total_count != null ? t('content.matchingRecords', { count: meta.total_count }) : t('app.contentDescription')}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => onNavigate?.(studioPath.contentNew(collection))}>
          {t('content.newRecord')}
        </button>
      </section>

      {!schemaLoading && (
        <section className="panel data-controls-panel" aria-label={t('content.dataControls', { collection: visibleCollectionName })}>
          <div className="data-controls-main content-data-controls-main">
            <label className="field-label control-search">
              <span>{t('common.search')}</span>
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={hasTextSearch ? t('content.searchTextFields') : t('content.noTextFields')}
                disabled={!hasTextSearch}
              />
            </label>

            <label className="field-label compact-control">
              <span>{t('content.sortBy')}</span>
              <select value={sortField} onChange={(event) => { setSortField(event.target.value); setOffset(0); }}>
                <option value="">{t('content.defaultOrder')}</option>
                {filterableFields.map((field) => <option key={field.field} value={field.field}>{fieldLabel(field)}</option>)}
              </select>
            </label>

            <label className="field-label compact-control">
              <span>{t('common.direction')}</span>
              <select
                value={sortDirection}
                disabled={!sortField}
                onChange={(event) => { setSortDirection(event.target.value); setOffset(0); }}
              >
                <option value="asc">{t('common.ascending')}</option>
                <option value="desc">{t('common.descending')}</option>
              </select>
            </label>
          </div>

          <div className="content-view-control-group">
            <button
              className="secondary-button mobile-filter-toggle"
              type="button"
              aria-expanded={mobileFiltersOpen}
              onClick={() => setMobileFiltersOpen((value) => !value)}
            >
              <span>{t('content.filters')}</span>
              <small>{t('content.filterCount', { count: filters.length })}</small>
            </button>
            <DataViewOptions
              columns={tableFields.map((field) => ({
                key: field.field,
                label: fieldLabel(field),
                secondary: field.field,
              }))}
              visibleKeys={visibleColumnKeys}
              density={density}
              onToggleColumn={toggleVisibleColumn}
              onDensityChange={setDensity}
              labels={{
                trigger: t('content.viewOptions'),
                title: t('content.viewOptionsTitle'),
                columns: t('content.columns'),
                density: t('content.density'),
                compact: t('content.densityCompact'),
                comfortable: t('content.densityComfortable'),
                relaxed: t('content.densityRelaxed'),
              }}
            />
          </div>

          <form className={`filter-builder ${mobileFiltersOpen ? 'mobile-open' : ''}`} onSubmit={addFilter}>
            <label className="field-label compact-control filter-field-control">
              <span>{t('content.filterField')}</span>
              <select value={filterDraft.field} onChange={(event) => updateFilterField(event.target.value)}>
                <option value="">{t('dataModel.chooseField')}</option>
                {filterableFields.map((field) => <option key={field.field} value={field.field}>{fieldLabel(field)}</option>)}
              </select>
            </label>
            <label className="field-label compact-control filter-operator-control">
              <span>{t('content.condition')}</span>
              <select
                value={filterDraft.operator}
                disabled={!selectedFilterField}
                onChange={(event) => setFilterDraft((current) => ({ ...current, operator: event.target.value, value: '' }))}
              >
                {filterOperators.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
              </select>
            </label>
            <label className="field-label filter-value-control">
              <span>{t('content.value')}</span>
              {['_null', '_nnull'].includes(filterDraft.operator) ? (
                <div className="control-placeholder">{t('content.noValueNeeded')}</div>
              ) : isFileField(selectedFilterField) ? (
                <select
                  value={filterDraft.value}
                  disabled={!selectedFilterField}
                  onChange={(event) => setFilterDraft((current) => ({ ...current, value: event.target.value }))}
                >
                  <option value="">{t('fileField.chooseFile')}</option>
                  {files
                    .filter((file) => !isImageField(selectedFilterField) || String(file.mimetype || '').startsWith('image/'))
                    .map((file) => <option key={file.id} value={file.id}>{file.title || file.filename_download}</option>)}
                </select>
              ) : relationLookups[filterDraft.field] ? (
                <RelationPicker
                  value={filterDraft.value}
                  items={relationLookups[filterDraft.field].items}
                  keyField={relationLookups[filterDraft.field].keyField}
                  labelField={relationLookups[filterDraft.field].labelField}
                  disabled={!selectedFilterField}
                  required
                  placeholder={t('content.chooseRecord')}
                  searchPlaceholder={t('content.relationSearch')}
                  emptyLabel={t('content.relationEmpty')}
                  noneLabel={t('common.none')}
                  onChange={(value) => setFilterDraft((current) => ({ ...current, value }))}
                />
              ) : selectedFilterField?.type === 'boolean' ? (
                <select
                  value={filterDraft.value}
                  disabled={!selectedFilterField}
                  onChange={(event) => setFilterDraft((current) => ({ ...current, value: event.target.value }))}
                >
                  <option value="">{t('content.chooseValue')}</option>
                  <option value="true">{t('common.yes')}</option>
                  <option value="false">{t('common.no')}</option>
                </select>
              ) : (
                <input
                  type={fieldInputType(selectedFilterField)}
                  step={selectedFilterField?.type === 'decimal' ? 'any' : undefined}
                  value={filterDraft.value}
                  disabled={!selectedFilterField}
                  onChange={(event) => setFilterDraft((current) => ({ ...current, value: event.target.value }))}
                  placeholder={selectedFilterField ? t('content.filterValue') : t('content.chooseFieldFirst')}
                />
              )}
            </label>
            <button className="secondary-button filter-add-button" type="submit" disabled={!selectedFilterField}>
              {t('content.addFilter')}
            </button>
          </form>

          <div className="active-controls-row">
            <div className="filter-chip-list" aria-label={t('content.activeFilters')}>
              {filters.map((filter) => {
                const operatorKey = operatorsForField(
                  filterableFields.find((field) => field.field === filter.field),
                  relationLookups[filter.field],
                ).find(([value]) => value === filter.operator)?.[1];
                return (
                  <button className="filter-chip" key={filter.id} type="button" onClick={() => removeFilter(filter.id)}>
                    <span>{filterFieldLabel(filter.field)} · {operatorKey ? t(operatorKey) : filter.operator} · {filterValueLabel(filter)}</span>
                    <strong aria-hidden="true">×</strong>
                  </button>
                );
              })}
              {filters.length === 0 && <span className="controls-hint">{t('content.filterHint')}</span>}
            </div>
            {hasActiveControls && <button className="text-button" type="button" onClick={clearControls}>{t('content.resetView')}</button>}
          </div>
        </section>
      )}

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}
      {selectedCount > 0 && (
        <div className="content-bulk-bar" role="region" aria-label={t('content.selectedCount', { count: selectedCount })}>
          <strong>{t('content.selectedCount', { count: selectedCount })}</strong>
          <div>
            <button className="text-button" type="button" onClick={() => setSelectedRecordIds(new Set())}>{t('common.cancel')}</button>
            <button className="danger-button" type="button" onClick={removeSelectedRecords}>{t('content.bulkDelete')}</button>
          </div>
        </div>
      )}
      {schemaLoading ? (
        <section className="panel"><p>{t('content.loadingCollection')}</p></section>
      ) : !itemsLoading && totalCount === 0 && !hasActiveControls ? (
        <section className="panel empty-state empty-state-action">
          <div><h2>{t('content.noRecordsYet')}</h2><p>{t('content.firstRecordDescription', { collection: visibleCollectionName })}</p></div>
          <button className="primary-button" type="button" onClick={() => onNavigate?.(studioPath.contentNew(collection))}>{t('content.createFirstRecord')}</button>
        </section>
      ) : !itemsLoading && totalCount === 0 ? (
        <section className="panel empty-state empty-state-action">
          <div><h2>{t('content.noRecords')}</h2><p>{t('content.noMatchDescription')}</p></div>
          <button className="text-button" type="button" onClick={clearControls}>{t('content.resetView')}</button>
        </section>
      ) : (
        <section className={`table-panel content-table-density-${density} ${itemsLoading ? 'is-loading' : ''}`} aria-busy={itemsLoading}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="content-selection-column">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={togglePageSelection}
                      aria-label={t('content.selectPage')}
                    />
                  </th>
                  {visibleTableFields.map((field) => (
                    <th
                      key={field.field}
                      aria-sort={sortField === field.field ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                      title={field.field}
                    >
                      <button className="sort-header-button" type="button" onClick={() => toggleColumnSort(field.field)}>
                        <span>{fieldLabel(field)}</span>
                        <span className="sort-indicator" aria-hidden="true">
                          {sortField === field.field ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th aria-label={t('common.actions')} />
                </tr>
              </thead>
              <tbody>
                {items.map((record) => {
                  const selected = selectedRecordIds.has(String(record.id));
                  return (
                    <tr
                      key={record.id}
                      className={`content-row-open ${selected ? 'content-row-selected' : ''}`}
                      onClick={(event) => {
                        if (event.target.closest?.('button, input, a, select, textarea, label')) return;
                        setInspectedRecord(record);
                      }}
                    >
                      <td className="content-selection-column">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleRecordSelection(record.id)}
                          aria-label={t('content.selectRecord', { id: record.id })}
                        />
                      </td>
                      {visibleTableFields.map((field) => (
                        <td key={field.field}>
                          {isFileField(field) ? (
                            <FileValuePreview field={field} value={record[field.field]} files={files} t={t} />
                          ) : renderValue(field, record, relationLookups, t, locale)}
                        </td>
                      ))}
                      <td className="row-actions">
                        <button className="text-button" type="button" onClick={() => setInspectedRecord(record)}>{t('content.quickEdit')}</button>
                        <button className="text-button" type="button" onClick={() => onNavigate?.(studioPath.contentRecord(collection, record.id))}>{t('common.edit')}</button>
                        <button className="danger-button" type="button" onClick={() => removeRecord(record)}>{t('common.delete')}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mobile-record-list" aria-label={visibleCollectionName}>
            {items.map((record) => {
              const primaryField = mobileRecordFields[0];
              return (
                <article className="mobile-record-card" key={record.id}>
                  <header>
                    <div>
                      <small>{primaryField ? fieldLabel(primaryField) : t('content.records')}</small>
                      <strong>{primaryField ? renderValue(primaryField, record, relationLookups, t, locale) : record.id}</strong>
                    </div>
                    <code>{record.id}</code>
                  </header>
                  <dl>
                    {mobileRecordFields.slice(1).map((field) => (
                      <div key={field.field}>
                        <dt>{fieldLabel(field)}</dt>
                        <dd>{isFileField(field) ? <FileValuePreview field={field} value={record[field.field]} files={files} t={t} /> : renderValue(field, record, relationLookups, t, locale)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mobile-card-actions">
                    <button className="secondary-button" type="button" onClick={() => setInspectedRecord(record)}>{t('content.quickEdit')}</button>
                    <button className="secondary-button" type="button" onClick={() => onNavigate?.(studioPath.contentRecord(collection, record.id))}>{t('common.edit')}</button>
                    <button className="danger-button" type="button" onClick={() => removeRecord(record)}>{t('common.delete')}</button>
                  </div>
                </article>
              );
            })}
          </div>
          <Pagination
            page={currentPage}
            pageSize={pageSize}
            totalItems={totalCount}
            pageSizeOptions={PAGE_SIZES}
            loading={itemsLoading}
            itemLabel={t('content.records')}
            onPageChange={(page) => setOffset((page - 1) * pageSize)}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setOffset(0);
            }}
          />
        </section>
      )}

      <Inspector
        open={Boolean(inspectedRecord)}
        title={inspectedRecord ? `${visibleCollectionName} · ${inspectedRecord.id}` : visibleCollectionName}
        description={t('content.quickEdit')}
        closeLabel={t('studio.inspectorClose')}
        onClose={() => setInspectedRecord(null)}
      >
        {inspectedRecord && (
          <RecordForm
            compact
            collection={collection}
            collectionLabel={collectionLabel}
            fields={fields}
            relationLookups={relationLookups}
            files={files}
            record={inspectedRecord}
            onFileUploaded={registerUploadedFile}
            onCancel={() => setInspectedRecord(null)}
            onOpenFull={() => {
              const recordId = inspectedRecord.id;
              setInspectedRecord(null);
              onNavigate?.(studioPath.contentRecord(collection, recordId));
            }}
            onSaved={async (saved) => {
              if (saved) setInspectedRecord(saved);
              setNotice(t('common.saved'));
              await loadItems();
            }}
          />
        )}
      </Inspector>
    </div>
  );
}

export { buildItemsPath, fieldLabel, renderValue };
