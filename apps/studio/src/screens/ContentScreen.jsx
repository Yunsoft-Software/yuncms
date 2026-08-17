import { useEffect, useMemo, useRef, useState } from 'react';

import { apiRequest } from '../api.js';
import { useConfirmDialog } from '../components/DialogProvider.jsx';

const PAGE_SIZES = [25, 50, 100];

const TEXT_OPERATORS = [
  ['_contains', 'Contains'],
  ['_starts_with', 'Starts with'],
  ['_ends_with', 'Ends with'],
  ['_eq', 'Is exactly'],
  ['_neq', 'Is not'],
  ['_null', 'Is empty'],
  ['_nnull', 'Is not empty'],
];

const ORDER_OPERATORS = [
  ['_eq', 'Equals'],
  ['_neq', 'Does not equal'],
  ['_gt', 'Greater than'],
  ['_gte', 'Greater than or equal'],
  ['_lt', 'Less than'],
  ['_lte', 'Less than or equal'],
  ['_null', 'Is empty'],
  ['_nnull', 'Is not empty'],
];

const BOOLEAN_OPERATORS = [
  ['_eq', 'Is'],
  ['_null', 'Is empty'],
  ['_nnull', 'Is not empty'],
];

const UUID_OPERATORS = [
  ['_eq', 'Is'],
  ['_neq', 'Is not'],
  ['_null', 'Is empty'],
  ['_nnull', 'Is not empty'],
];

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
  if (relationLookup) return UUID_OPERATORS;
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

function RecordForm({ collection, fields, relationLookups, record, onSaved, onCancel }) {
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
      setError(requestError.message || 'Record could not be saved');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel form-panel record-editor" onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{record?.id ? 'Edit record' : 'New record'}</p>
          <h2>{collection}</h2>
          <p>{record?.id ? 'Update the fields below.' : 'Add a new item to this collection.'}</p>
        </div>
        <button className="text-button" type="button" onClick={onCancel}>Cancel</button>
      </div>

      <div className="form-grid">
        {editable.map((field) => {
          const relationLookup = relationLookups[field.field];
          const currentValue = values[field.field] ?? '';
          const hasCurrentOption = relationLookup?.items.some(
            (entry) => String(entry[relationLookup.keyField]) === String(currentValue),
          );

          return (
            <label className="field-label" key={field.field}>
              <span>{field.field}{field.required ? ' *' : ''}</span>
              {relationLookup ? (
                <select
                  value={currentValue}
                  onChange={(event) => setValues((current) => ({
                    ...current,
                    [field.field]: event.target.value,
                  }))}
                  required={Boolean(field.required)}
                >
                  <option value="">{field.required ? 'Select…' : 'None'}</option>
                  {currentValue && !hasCurrentOption && (
                    <option value={currentValue}>{`Unknown (${currentValue})`}</option>
                  )}
                  {relationLookup.items.map((item) => {
                    const value = item[relationLookup.keyField];
                    return (
                      <option key={String(value)} value={String(value)}>
                        {lookupLabel(relationLookup, value)}
                      </option>
                    );
                  })}
                </select>
              ) : field.type === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={Boolean(values[field.field])}
                  onChange={(event) => setValues((current) => ({
                    ...current,
                    [field.field]: event.target.checked,
                  }))}
                />
              ) : field.type === 'text' || field.type === 'json' ? (
                <textarea
                  rows={field.type === 'json' ? 6 : 4}
                  value={values[field.field] ?? ''}
                  onChange={(event) => setValues((current) => ({
                    ...current,
                    [field.field]: event.target.value,
                  }))}
                  required={Boolean(field.required)}
                />
              ) : (
                <input
                  type={fieldInputType(field)}
                  step={field.type === 'decimal' ? 'any' : undefined}
                  value={values[field.field] ?? ''}
                  onChange={(event) => setValues((current) => ({
                    ...current,
                    [field.field]: event.target.value,
                  }))}
                  required={Boolean(field.required)}
                />
              )}
              {relationLookup && (
                <small>{relationLookup.targetCollection} · display: {relationLookup.labelField}</small>
              )}
            </label>
          );
        })}
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save record'}
        </button>
      </div>
    </form>
  );
}

export function ContentScreen({ collection, onOpenDataModel }) {
  const requestConfirmation = useConfirmDialog();
  const requestVersion = useRef(0);
  const [fields, setFields] = useState([]);
  const [relationLookups, setRelationLookups] = useState({});
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
      relation.many_collection === target &&
      !relation.junction_collection &&
      relationKind(relation) !== 'm2m');

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
    if (!target) {
      setFields([]);
      setItems([]);
      setRelationLookups({});
      setMeta(null);
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
      const lookups = await buildRelationLookups(target, loadedRelations);
      setFields(loadedFields);
      setRelationLookups(lookups);
    } catch (requestError) {
      setError(requestError.message || 'Collection schema could not be loaded');
    } finally {
      setSchemaLoading(false);
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
      setError(requestError.message || 'Collection data could not be loaded');
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
    setMeta(null);
    setItems([]);
    loadCollectionSchema(collection);
  }, [collection]);

  useEffect(() => {
    if (!collection || schemaLoading || fields.length === 0) return;
    loadItems(collection, fields);
  }, [collection, fields, filters, offset, pageSize, schemaLoading, search, sortDirection, sortField]);

  async function removeRecord(record) {
    if (!record?.id) return;
    const accepted = await requestConfirmation({
      title: 'Delete record?',
      description: `Record ${record.id} will be permanently deleted from ${collection}.`,
      confirmLabel: 'Delete record',
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
      setError(requestError.message || 'Record could not be deleted');
    }
  }

  const tableFields = useMemo(() => fields.filter((field) => !field.hidden).slice(0, 8), [fields]);
  const filterableFields = useMemo(() => fields.filter((field) =>
    !field.hidden && field.type !== 'json'), [fields]);
  const selectedFilterField = filterableFields.find((field) => field.field === filterDraft.field) ?? null;
  const filterOperators = operatorsForField(selectedFilterField, relationLookups[filterDraft.field]);
  const hasTextSearch = fields.some((field) => !field.hidden && ['string', 'text'].includes(field.type));
  const totalCount = Number(meta?.total_count ?? 0);
  const visibleStart = totalCount === 0 ? 0 : offset + 1;
  const visibleEnd = Math.min(offset + items.length, totalCount);
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
    if (filter.operator === '_null') return 'empty';
    if (filter.operator === '_nnull') return 'not empty';
    const lookup = relationLookups[filter.field];
    return lookup ? lookupLabel(lookup, filter.value) : String(filter.value);
  }

  if (creating || editing) {
    return (
      <RecordForm
        collection={collection}
        fields={fields}
        relationLookups={relationLookups}
        record={editing}
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
          <p className="eyebrow">Content</p>
          <h2>No collections yet</h2>
          <p>Create your first collection in Data Model. It will appear directly in the Content sidebar.</p>
        </div>
        {onOpenDataModel && (
          <button className="primary-button" type="button" onClick={onOpenDataModel}>Open Data Model</button>
        )}
      </section>
    );
  }

  return (
    <div className="screen-stack">
      <section className="panel toolbar-panel content-toolbar">
        <div>
          <p className="eyebrow">Collection</p>
          <h2>{collection}</h2>
          <p>{meta?.total_count != null ? `${meta.total_count} matching records` : 'Manage records in this collection.'}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setCreating(true)}>
          New record
        </button>
      </section>

      {!schemaLoading && (
        <section className="panel data-controls-panel" aria-label={`${collection} data controls`}>
          <div className="data-controls-main">
            <label className="field-label control-search">
              <span>Search</span>
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={hasTextSearch ? 'Search text fields…' : 'No text fields to search'}
                disabled={!hasTextSearch}
              />
            </label>

            <label className="field-label compact-control">
              <span>Sort by</span>
              <select
                value={sortField}
                onChange={(event) => { setSortField(event.target.value); setOffset(0); }}
              >
                <option value="">Default order</option>
                {filterableFields.map((field) => <option key={field.field} value={field.field}>{field.field}</option>)}
              </select>
            </label>

            <label className="field-label compact-control">
              <span>Direction</span>
              <select
                value={sortDirection}
                disabled={!sortField}
                onChange={(event) => { setSortDirection(event.target.value); setOffset(0); }}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>

            <label className="field-label compact-control page-size-control">
              <span>Rows</span>
              <select
                value={pageSize}
                onChange={(event) => { setPageSize(Number(event.target.value)); setOffset(0); }}
              >
                {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
          </div>

          <form className="filter-builder" onSubmit={addFilter}>
            <label className="field-label compact-control filter-field-control">
              <span>Filter field</span>
              <select value={filterDraft.field} onChange={(event) => updateFilterField(event.target.value)}>
                <option value="">Choose field</option>
                {filterableFields.map((field) => <option key={field.field} value={field.field}>{field.field}</option>)}
              </select>
            </label>
            <label className="field-label compact-control filter-operator-control">
              <span>Condition</span>
              <select
                value={filterDraft.operator}
                disabled={!selectedFilterField}
                onChange={(event) => setFilterDraft((current) => ({ ...current, operator: event.target.value, value: '' }))}
              >
                {filterOperators.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="field-label filter-value-control">
              <span>Value</span>
              {['_null', '_nnull'].includes(filterDraft.operator) ? (
                <div className="control-placeholder">No value needed</div>
              ) : relationLookups[filterDraft.field] ? (
                <select
                  value={filterDraft.value}
                  disabled={!selectedFilterField}
                  onChange={(event) => setFilterDraft((current) => ({ ...current, value: event.target.value }))}
                >
                  <option value="">Choose record</option>
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
                  <option value="">Choose value</option>
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              ) : (
                <input
                  type={fieldInputType(selectedFilterField)}
                  step={selectedFilterField?.type === 'decimal' ? 'any' : undefined}
                  value={filterDraft.value}
                  disabled={!selectedFilterField}
                  onChange={(event) => setFilterDraft((current) => ({ ...current, value: event.target.value }))}
                  placeholder={selectedFilterField ? 'Filter value' : 'Choose a field first'}
                />
              )}
            </label>
            <button className="secondary-button filter-add-button" type="submit" disabled={!selectedFilterField}>
              Add filter
            </button>
          </form>

          <div className="active-controls-row">
            <div className="filter-chip-list" aria-label="Active filters">
              {filters.map((filter) => {
                const operatorLabel = operatorsForField(
                  filterableFields.find((field) => field.field === filter.field),
                  relationLookups[filter.field],
                ).find(([value]) => value === filter.operator)?.[1] || filter.operator;
                return (
                  <button className="filter-chip" key={filter.id} type="button" onClick={() => removeFilter(filter.id)}>
                    <span>{filter.field} · {operatorLabel} · {filterValueLabel(filter)}</span>
                    <strong aria-hidden="true">×</strong>
                  </button>
                );
              })}
              {filters.length === 0 && <span className="controls-hint">Add filters to narrow this collection.</span>}
            </div>
            {hasActiveControls && <button className="text-button" type="button" onClick={clearControls}>Reset view</button>}
          </div>
        </section>
      )}

      {error && <div className="error-banner" role="alert">{error}</div>}
      {schemaLoading ? (
        <section className="panel"><p>Loading collection…</p></section>
      ) : !itemsLoading && totalCount === 0 && !hasActiveControls ? (
        <section className="panel empty-state empty-state-action">
          <div><h2>No records yet</h2><p>Add the first record to {collection}.</p></div>
          <button className="primary-button" type="button" onClick={() => setCreating(true)}>Create first record</button>
        </section>
      ) : !itemsLoading && totalCount === 0 ? (
        <section className="panel empty-state empty-state-action">
          <div><h2>No matching records</h2><p>Remove a filter or change your search to broaden the results.</p></div>
          <button className="text-button" type="button" onClick={clearControls}>Reset view</button>
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
                    >
                      <button className="sort-header-button" type="button" onClick={() => toggleColumnSort(field.field)}>
                        <span>{field.field}</span>
                        <span className="sort-indicator" aria-hidden="true">
                          {sortField === field.field ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {items.map((record) => (
                  <tr key={record.id}>
                    {tableFields.map((field) => (
                      <td key={field.field}>{renderValue(field, record, relationLookups)}</td>
                    ))}
                    <td className="row-actions">
                      <button className="text-button" type="button" onClick={() => setEditing(record)}>Edit</button>
                      <button className="danger-button" type="button" onClick={() => removeRecord(record)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer pagination-footer">
            <span>{itemsLoading ? 'Refreshing…' : `Showing ${visibleStart}–${visibleEnd} of ${totalCount}`}</span>
            <div className="pagination-actions">
              <button
                className="text-button"
                type="button"
                disabled={offset === 0 || itemsLoading}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
              >
                Previous
              </button>
              <button
                className="text-button"
                type="button"
                disabled={offset + pageSize >= totalCount || itemsLoading}
                onClick={() => setOffset(offset + pageSize)}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
