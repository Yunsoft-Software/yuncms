import { useEffect, useMemo, useRef, useState } from 'react';

import { apiRequest } from '../api.js';
import { useConfirmDialog } from '../components/DialogProvider.jsx';
import { FileFieldControl, FileValuePreview } from '../components/FileFieldControl.jsx';
import { Pagination } from '../components/Pagination.jsx';
import { contentTableFields, isFileField, isImageField } from '../field-ui.js';
import { useI18n } from '../i18n.js';
import { displaySchemaName } from '../schema-name.js';

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

function renderValue(field, record, relationLookups) {
  const value = record[field.field];
  const lookup = relationLookups[field.field];
  if (lookup) return lookupLabel(lookup, value);
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
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

function RecordForm({ collection, collectionLabel, fields, relationLookups, files, record, onFileUploaded, onSaved, onCancel }) {
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
    <form className="panel form-panel record-editor" onSubmit={submit}>
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
          const hasCurrentOption = relationLookup?.items.some(
            (entry) => String(entry[relationLookup.keyField]) === String(currentValue),
          );
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
                <select
                  value={currentValue}
                  onChange={(event) => setValues((current) => ({ ...current, [field.field]: event.target.value }))}
                  required={Boolean(field.required)}
                >
                  <option value="">{field.required ? t('content.select') : t('common.none')}</option>
                  {currentValue && !hasCurrentOption && (
                    <option value={currentValue}>{t('content.unknownValue', { value: currentValue })}</option>
                  )}
                  {relationLookup.items.map((item) => {
                    const value = item[relationLookup.keyField];
                    return <option key={String(value)} value={String(value)}>{lookupLabel(relationLookup, value)}</option>;
                  })}
                </select>
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
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? t('common.saving') : t('content.saveRecord')}
        </button>
      </div>
    </form>
  );
}

export function ContentScreen({ collection, collectionLabel = '', onOpenDataModel }) {
  const { t } = useI18n();
  const requestConfirmation = useConfirmDialog();
  const requestVersion = useRef(0);
  const schemaLoadingRef = useRef(true);
  const [fields, setFields] = useState([]);
  const [relationLookups, setRelationLookups] = useState({});
  const [files, setFiles] = useState([]);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState([]);
  const [filterDraft, setFilterDraft] = useState({ field: '', operator: '_contains', value: '' });
  const [sortField, setSortField] = useState('');
  const [sortDirection, setSortDirection] = useState('asc');
  const [pageSize, setPageSize] = useState(25);
  const [offset, setOffset] = useState(0);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState('');

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
      setItems(response?.data ?? []);
      setMeta(response?.meta ?? null);
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
    setEditing(null);
    setCreating(false);
    setSearchInput('');
    setSearch('');
    setFilters([]);
    setFilterDraft({ field: '', operator: '_contains', value: '' });
    setSortField('');
    setSortDirection('asc');
    setOffset(0);
    loadCollectionSchema(collection);
  }, [collection]);

  useEffect(() => {
    // The collection-change effect above starts the schema request in the same
    // effect flush. The ref closes the one-render window before the loading
    // state update is visible, so stale fields cannot start an item request and
    // invalidate the schema request version.
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
    try {
      await apiRequest(
        `/items/${encodeURIComponent(collection)}/${encodeURIComponent(record.id)}`,
        { method: 'DELETE' },
      );
      if (items.length === 1 && offset > 0) {
        setOffset(Math.max(0, offset - pageSize));
      } else {
        await loadItems();
      }
    } catch (requestError) {
      setError(requestError.message || t('content.deleteError'));
    }
  }

  const tableFields = useMemo(() => contentTableFields(fields), [fields]);
  const filterableFields = useMemo(() => fields.filter((field) => !field.hidden && field.type !== 'json'), [fields]);
  const selectedFilterField = filterableFields.find((field) => field.field === filterDraft.field) ?? null;
  const filterOperators = operatorsForField(selectedFilterField, relationLookups[filterDraft.field]);
  const hasTextSearch = fields.some((field) => !field.hidden && ['string', 'text'].includes(field.type));
  const totalCount = Number(meta?.total_count ?? 0);
  const currentPage = Math.floor(offset / pageSize) + 1;
  const hasActiveControls = Boolean(search || filters.length > 0 || sortField);

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

  if (creating || editing) {
    return (
      <RecordForm
        collection={collection}
        collectionLabel={collectionLabel}
        fields={fields}
        relationLookups={relationLookups}
        files={files}
        record={editing}
        onFileUploaded={registerUploadedFile}
        onCancel={() => { setCreating(false); setEditing(null); }}
        onSaved={async () => {
          setCreating(false);
          setEditing(null);
          await loadItems();
        }}
      />
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

  const visibleCollectionName = collectionLabel || collection;

  return (
    <div className="screen-stack">
      <section className="panel toolbar-panel content-toolbar">
        <div>
          <p className="eyebrow">{t('visibility.collection')}</p>
          <h2>{visibleCollectionName}</h2>
          {visibleCollectionName !== collection && <code className="schema-machine-key">{collection}</code>}
          <p>{meta?.total_count != null ? t('content.matchingRecords', { count: meta.total_count }) : t('app.contentDescription')}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setCreating(true)}>
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

          <form className="filter-builder" onSubmit={addFilter}>
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
                <select
                  value={filterDraft.value}
                  disabled={!selectedFilterField}
                  onChange={(event) => setFilterDraft((current) => ({ ...current, value: event.target.value }))}
                >
                  <option value="">{t('content.chooseRecord')}</option>
                  {relationLookups[filterDraft.field].items.map((item) => {
                    const lookup = relationLookups[filterDraft.field];
                    const value = item[lookup.keyField];
                    return <option key={String(value)} value={String(value)}>{lookupLabel(lookup, value)}</option>;
                  })}
                </select>
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
      {schemaLoading ? (
        <section className="panel"><p>{t('content.loadingCollection')}</p></section>
      ) : !itemsLoading && totalCount === 0 && !hasActiveControls ? (
        <section className="panel empty-state empty-state-action">
          <div><h2>{t('content.noRecordsYet')}</h2><p>{t('content.firstRecordDescription', { collection: visibleCollectionName })}</p></div>
          <button className="primary-button" type="button" onClick={() => setCreating(true)}>{t('content.createFirstRecord')}</button>
        </section>
      ) : !itemsLoading && totalCount === 0 ? (
        <section className="panel empty-state empty-state-action">
          <div><h2>{t('content.noRecords')}</h2><p>{t('content.noMatchDescription')}</p></div>
          <button className="text-button" type="button" onClick={clearControls}>{t('content.resetView')}</button>
        </section>
      ) : (
        <section className={`table-panel ${itemsLoading ? 'is-loading' : ''}`} aria-busy={itemsLoading}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {tableFields.map((field) => (
                    <th
                      key={field.field}
                      aria-sort={sortField === field.field ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                      title={field.field}
                    >
                      <button className="sort-header-button" type="button" onClick={() => toggleColumnSort(field.field)}>
                        <span>{fieldLabel(field)}</span>
                        <span className="sort-indicator" aria-hidden="true">
                          {sortField === field.field ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th aria-label={t('common.actions')} />
                </tr>
              </thead>
              <tbody>
                {items.map((record) => (
                  <tr key={record.id}>
                    {tableFields.map((field) => (
                      <td key={field.field}>
                        {isFileField(field) ? (
                          <FileValuePreview field={field} value={record[field.field]} files={files} t={t} />
                        ) : renderValue(field, record, relationLookups)}
                      </td>
                    ))}
                    <td className="row-actions">
                      <button className="text-button" type="button" onClick={() => setEditing(record)}>{t('common.edit')}</button>
                      <button className="danger-button" type="button" onClick={() => removeRecord(record)}>{t('common.delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
    </div>
  );
}

export { buildItemsPath, fieldLabel };
