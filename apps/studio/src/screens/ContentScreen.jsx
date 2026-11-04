import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { confirmStudioNavigation, useUnsavedChanges } from '../use-unsaved-changes.js';
import { ContentHistory } from '../premium/ContentHistory.jsx';
import { contentDraftKey, editHeaders, editRequest } from '../content-edit-state.js';
import { apiRequest, readSession } from '../api.js';
import {
  BooleanFieldControl,
  DataViewOptions,
  FileFieldControl,
  FileValuePreview,
  Inspector,
  ManualFlowActions,
  NestedRelationCell,
  NestedRelationsEditor,
  Pagination,
  RelationPicker,
  RichTextEditor,
  TableCellText,
  TableRowActions,
  useConfirmDialog,
} from '../components/index.js';
import { inputValueForField, outputValueForField } from '../content-field-values.js';
import { contentColumnKind, flexibleContentColumnKey } from '../content-presentation.js';
import { formatDateFieldValue } from '../date-format.js';
import {
  canWriteContent,
  directContentRelations,
  contentRecordValuesKey,
  contentWritableFields,
  loadRelationLookup,
  normalizeRecordPrimaryKey,
  primaryKeyFieldForFields,
} from '../content-access.js';
import { contentEmptyState } from '../content-empty-state.js';
import {
  buildInitialNestedDraft,
  discoverNestedRelations,
  loadNestedRecordRows,
  loadNestedSummariesForItems,
  nestedRelationsHaveFiles,
  saveNestedRelations,
  searchNestedParentIds,
  virtualRelationColumns,
} from '../content-relations.js';
import {
  contentTableFields,
  defaultContentColumnKeys,
  isFileField,
  isImageField,
  isReadOnlyField,
  isRichTextField,
  isSelectDropdownField,
  selectChoicesForField,
} from '../field-ui.js';
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

function relationKind(relation) {
  if (!relation?.metadata) return 'm2o';
  if (typeof relation.metadata === 'object') return relation.metadata.kind || 'm2o';
  try {
    return JSON.parse(relation.metadata)?.kind || 'm2o';
  } catch {
    return 'm2o';
  }
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
  if (lookup) return <TableCellText>{lookupLabel(lookup, value)}</TableCellText>;
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
    const formatted = formatDateFieldValue(field.type, value, locale);
    if (formatted) {
      return <time className="content-value-date" dateTime={formatted.dateTime}>{formatted.formatted}</time>;
    }
  }
  if (field.field === 'status' || field.field.endsWith('_status')) {
    const choice = selectChoicesForField(field).find((entry) => String(entry.value) === String(value));
    return <span className="content-value-status" data-status={String(value)}>{choice?.label || String(value)}</span>;
  }
  if (isRichTextField(field) && typeof value === 'string') {
    const plain = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return plain ? <TableCellText multiline>{plain}</TableCellText> : <span className="content-value-empty">—</span>;
  }
  if (typeof value === 'object') return <TableCellText code>{JSON.stringify(value)}</TableCellText>;
  return <TableCellText code={contentColumnKind(field) === 'identity'} multiline={field.type === 'text'}>{String(value)}</TableCellText>;
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
  if (['integer', 'bigint', 'decimal'].includes(field?.type)) return outputValueForField({ ...field, required: true }, value);
  return value;
}

function fieldInputType(field) {
  if (['integer', 'bigint', 'decimal'].includes(field?.type)) return 'number';
  if (field?.type === 'date') return 'date';
  if (['datetime', 'timestamp'].includes(field?.type)) return 'datetime-local';
  return 'text';
}

function buildItemsPath({ collection, fields, search, matchedParentIds = null, filters, sortField, sortDirection, limit, offset }) {
  const clauses = filters.map((entry) => ({
    [entry.field]: { [entry.operator]: entry.value },
  }));
  const searchFields = fields.filter((field) => !field.hidden && ['string', 'text'].includes(field.type));
  if (search) {
    const orClauses = searchFields.map((field) => ({ [field.field]: { _contains: search } }));
    if (Array.isArray(matchedParentIds)) {
      if (matchedParentIds.length > 0) {
        orClauses.push({ id: { _in: matchedParentIds } });
      } else if (orClauses.length === 0) {
        orClauses.push({ id: { _eq: '__no_nested_match__' } });
      }
    }
    if (orClauses.length > 0) {
      clauses.push({ _or: orClauses });
    }
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
  nestedRelations = [],
  files,
  record,
  onFileUploaded,
  onSaved,
  onCancel,
  onOpenFull,
  compact = false,
  capabilities = null,
  historyEnabled = false,
}) {
  const { t } = useI18n();
  const action = record?.id ? 'update' : 'create';
  const canSave = canWriteContent(capabilities, action, record?.id ?? null);
  const allowedFieldsKey = JSON.stringify(capabilities?.[action]?.fields);
  const editable = useMemo(() => canSave ? contentWritableFields(fields, capabilities, action, isReadOnlyField) : fields.filter(field => !isReadOnlyField(field)), [fields, allowedFieldsKey, action, canSave]);
  const recordValuesKey = contentRecordValuesKey(record, editable);
  const initialValues = () => Object.fromEntries(editable.map(field => [field.field, inputValueForField(field, record?.[field.field])]));
  const [values, setValues] = useState(initialValues);
  const [existingNestedRows, setExistingNestedRows] = useState({});
  const [nestedDraft, setNestedDraft] = useState(() => buildInitialNestedDraft(nestedRelations, {}));
  const [nestedLoading, setNestedLoading] = useState(() => Boolean(record?.id && nestedRelations?.length));
  const [nestedFailed, setNestedFailed] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const cleanNestedDraft = useRef(nestedDraft);
  const [cleanKey, setCleanKey] = useState(() => contentDraftKey(values, nestedDraft));
  const draftKey = contentDraftKey(values, nestedDraft);
  const currentDraftKey = useRef(draftKey); currentDraftKey.current = draftKey;
  const dirty = draftKey !== cleanKey;
  const unsaved = useUnsavedChanges(dirty && !saving);
  const savedRecordRef = useRef(record);
  const [historyLicensed, setHistoryLicensed] = useState(false);
  useEffect(() => {
    let active = true;
    if (historyEnabled && readSession()?.user?.admin) apiRequest('/features').then(result => {
      if (active) setHistoryLicensed(result.data.features.contentHistory.enabled);
    }).catch(() => { if (active) setHistoryLicensed(false); });
    else setHistoryLicensed(false);
    return () => { active = false; };
  }, [historyEnabled]);

  useLayoutEffect(() => {
    const initialized = initialValues();
    setValues(initialized);
    savedRecordRef.current = record;
    setCleanKey(contentDraftKey(initialized, cleanNestedDraft.current)); unsaved.clear();
    setError('');
  }, [recordValuesKey]);

  useEffect(() => {
    let active = true;
    setNestedFailed(false);
    if (!nestedRelations || nestedRelations.length === 0) {
      setExistingNestedRows({});
      setNestedDraft({});
      cleanNestedDraft.current = {};
      setCleanKey(contentDraftKey(initialValues(), {}));
      setNestedLoading(false);
      return () => { active = false; };
    }
    if (!record?.id) {
      setExistingNestedRows({});
      const initialized = buildInitialNestedDraft(nestedRelations, {});
      setNestedDraft(initialized);
      cleanNestedDraft.current = structuredClone(initialized);
      setCleanKey(contentDraftKey(initialValues(), initialized));
      setNestedLoading(false);
      return () => { active = false; };
    }
    setNestedLoading(true);
    loadNestedRecordRows(nestedRelations, record.id, { request: apiRequest })
      .then((loaded) => {
        if (!active) return;
        setExistingNestedRows(loaded);
        const initialized = buildInitialNestedDraft(nestedRelations, loaded, inputValueForField);
        setNestedDraft(initialized);
        cleanNestedDraft.current = structuredClone(initialized);
        setCleanKey(contentDraftKey(initialValues(), initialized));
      })
      .catch((failure) => {
        if (!active) return;
        setNestedFailed(true);
        setError(failure.message);
        setExistingNestedRows({});
        setNestedDraft(buildInitialNestedDraft(nestedRelations, {}, inputValueForField));
      })
      .finally(() => {
        if (active) setNestedLoading(false);
      });
    return () => { active = false; };
  }, [record?.id, nestedRelations]);

  function changeValue(field, value) {
    setValues(current => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!canSave || nestedLoading || nestedFailed) return;
    setSaving(true);
    setError('');
    try {
      const payload = Object.fromEntries(editable.map((field) => [
        field.field,
        outputValueForField(field, values[field.field]),
      ]));
      let savedRecord = savedRecordRef.current ?? null;
      if (!savedRecord?.id || Object.keys(payload).length > 0) {
        const path = savedRecord?.id
          ? `/items/${encodeURIComponent(collection)}/${encodeURIComponent(savedRecord.id)}`
          : `/items/${encodeURIComponent(collection)}`;
        const result = await editRequest(apiRequest)(path, {
          method: savedRecord?.id ? 'PATCH' : 'POST',
          headers: editHeaders(savedRecord),
          body: payload,
        });
        savedRecord = result?.data ?? savedRecord;
        savedRecordRef.current = savedRecord;
      }
      let savedDraft = nestedDraft;
      const parentId = savedRecord?.id ?? record?.id;
      if (parentId != null && nestedRelations.length > 0 && !nestedLoading) {
        const progress = await saveNestedRelations({
          parentId,
          nestedRelations,
          draftState: nestedDraft,
          existingRowsByKey: existingNestedRows,
          request: apiRequest,
          outputValueForField,
          onProgress: progress => {
            setNestedDraft(structuredClone(progress.draftState));
            setExistingNestedRows({ ...progress.existingRowsByKey });
          },
        });
        savedDraft = progress?.draftState ?? savedDraft;
      }
      cleanNestedDraft.current = structuredClone(savedDraft);
      setCleanKey(contentDraftKey(values, savedDraft)); unsaved.clear();
      await onSaved(savedRecord);
    } catch (requestError) {
      setError(requestError.code === 'ITEM_REVISION_CONFLICT' ? t('features.editConflict') : requestError.message || t('content.saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={`panel form-panel record-editor ${compact ? 'record-editor-compact' : ''}`} aria-busy={nestedLoading} onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{record?.id ? t('content.editRecord') : t('content.newRecord')}</p>
          <h2>{collectionLabel || collection}</h2>
          {collectionLabel && collectionLabel !== collection && <code className="schema-machine-key">{collection}</code>}
          <p>{record?.id ? t('content.updateDescription') : t('content.createDescription')}</p>
        </div>
        <button className="text-button" type="button" onClick={async () => { if (await unsaved.confirmDiscard()) { setCleanKey(currentDraftKey.current); unsaved.clear(); onCancel(); } }}>{t('common.cancel')}</button>
      </div>

      {editable.length > 0 && (
        <fieldset className="form-grid record-form-grid" disabled={!canSave || saving}>
          {editable.map((field) => {
            const relationLookup = relationLookups[field.field];
            const currentValue = values[field.field] ?? '';
            const label = fieldLabel(field);
            const richText = isRichTextField(field);
            const FieldTag = richText ? 'div' : 'label';

            return (
              <FieldTag
                className={`field-label ${isFileField(field) ? 'file-field-label' : ''} ${richText ? 'richtext-field-label' : ''}`}
                data-field={field.field}
                key={field.field}
              >
                <span>{label}{field.required ? ' *' : ''}</span>
                {label !== field.field && <small className="field-api-key">{field.field}</small>}
                {isFileField(field) ? (
                  <FileFieldControl
                    field={field}
                    value={currentValue}
                    files={files}
                    t={t}
                    onFileUploaded={onFileUploaded}
                    onChange={(value) => changeValue(field.field, value)}
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
                    onChange={(value) => changeValue(field.field, value)}
                  />
                ) : isSelectDropdownField(field) ? (
                  <select
                    value={values[field.field] ?? ''}
                    onChange={(event) => changeValue(field.field, event.currentTarget.value)}
                    required={Boolean(field.required)}
                  >
                    <option value="">{field.required ? t('content.select') : t('common.none')}</option>
                    {selectChoicesForField(field).map((choice) => (
                      <option key={choice.value} value={choice.value}>{choice.label}</option>
                    ))}
                  </select>
                ) : richText ? (
                  <RichTextEditor
                    value={values[field.field] ?? ''}
                    onChange={(nextValue) => changeValue(field.field, nextValue)}
                    disabled={!canSave || saving}
                    files={files}
                    onFileUploaded={onFileUploaded}
                  />
                ) : field.type === 'boolean' ? (
                  <BooleanFieldControl label={label} value={values[field.field]} onChange={value => changeValue(field.field, value)} />
                ) : field.type === 'text' || field.type === 'json' ? (
                  <textarea
                    rows={field.type === 'json' ? 6 : 4}
                    value={values[field.field] ?? ''}
                    onChange={(event) => changeValue(field.field, event.currentTarget.value)}
                    required={Boolean(field.required)}
                  />
                ) : (
                  <input
                    type={fieldInputType(field)}
                    step={field.type === 'decimal' ? 'any' : undefined}
                    value={values[field.field] ?? ''}
                    onChange={(event) => changeValue(field.field, event.currentTarget.value)}
                    required={Boolean(field.required)}
                  />
                )}
              </FieldTag>
            );
          })}
        </fieldset>
      )}

      {nestedRelations.length > 0 && (
        <NestedRelationsEditor
          nestedRelations={nestedRelations}
          draftState={nestedDraft}
          setDraftState={setNestedDraft}
          files={files}
          onFileUploaded={onFileUploaded}
          disabled={!canSave || saving || nestedLoading || nestedFailed}
          compact={compact}
        />
      )}

      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="form-actions">
        {historyEnabled && historyLicensed && record?.id && <ContentHistory collection={collection} record={savedRecordRef.current ?? record} disabled={saving} onRestored={async () => {
          const current = (await editRequest(apiRequest)(`/items/${encodeURIComponent(collection)}/${encodeURIComponent(record.id)}`)).data;
          savedRecordRef.current = current;
          const initialized = Object.fromEntries(editable.map(field => [field.field, inputValueForField(field, current[field.field])]));
          setValues(initialized);
          setCleanKey(contentDraftKey(initialized, cleanNestedDraft.current)); unsaved.clear(); setError('');
        }} />}
        {compact && onOpenFull && (
          <button className="secondary-button" type="button" onClick={async () => { if (await unsaved.confirmDiscard()) { setCleanKey(currentDraftKey.current); unsaved.clear(); onOpenFull(); } }}>
            {t('content.openFullEditor')}
          </button>
        )}
        {canSave && <button className="primary-button" type="submit" disabled={!canSave || saving || nestedLoading || nestedFailed}>
          {saving ? t('common.saving') : t('content.saveRecord')}
        </button>}
      </div>
    </form>
  );
}

export function ContentScreen({ collection, collectionLabel = '', collections = [], visibleCollectionCount = 0, onOpenDataModel, route = {}, onNavigate }) {
  const { locale, t } = useI18n();
  const requestConfirmation = useConfirmDialog();
  const collectionMetadata = collections.find(entry => entry.collection === collection)?.metadata;
  let historyEnabled = false;
  try { historyEnabled = (typeof collectionMetadata === 'string' ? JSON.parse(collectionMetadata) : collectionMetadata)?.contentTracking?.history === true; } catch { /* optional metadata */ }
  const collectionLabelVersion = JSON.stringify(collections.map((entry) => [entry.collection, entry.name]));
  const requestVersion = useRef(0);
  const schemaLoadingRef = useRef(true);
  const [fields, setFields] = useState([]);
  const [capabilities, setCapabilities] = useState(null);
  const [relationLookups, setRelationLookups] = useState({});
  const [nestedRelations, setNestedRelations] = useState([]);
  const [nestedSummaries, setNestedSummaries] = useState({});
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
    const directRelations = directContentRelations(target, relations);

    const isAdmin = Boolean(readSession()?.user?.admin);
    const entries = await Promise.all(
      directRelations.map((relation) => loadRelationLookup(relation, { isAdmin, request: apiRequest, locale })),
    );

    return Object.fromEntries(entries);
  }

  async function loadCollectionSchema(target = collection) {
    const version = ++requestVersion.current;
    schemaLoadingRef.current = true;
    setFields([]);
    setCapabilities(null);
    setRelationLookups({});
    setNestedRelations([]);
    setNestedSummaries({});
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
      const isAdmin = Boolean(readSession()?.user?.admin);
      const [fieldResponse, relationResponse, capabilityResponse] = await Promise.all([
        apiRequest(`${isAdmin ? '/schema' : '/studio-navigation'}/collections/${encodeURIComponent(target)}/fields`),
        isAdmin ? apiRequest('/schema/relations') : apiRequest('/studio-navigation/relations'),
        apiRequest(`/studio-navigation/collections/${encodeURIComponent(target)}/capabilities`),
      ]);
      const loadedFields = fieldResponse?.data ?? [];
      const loadedRelations = relationResponse?.data ?? [];
      const [lookups, discoveredNested] = await Promise.all([
        buildRelationLookups(target, loadedRelations),
        discoverNestedRelations(target, loadedRelations, { isAdmin, request: apiRequest, locale }),
      ]);
      const needsFiles = loadedFields.some(isFileField) || nestedRelationsHaveFiles(discoveredNested);
      const fileResponse = needsFiles
        ? await apiRequest('/files').catch(() => ({ data: [] }))
        : { data: [] };
      if (version !== requestVersion.current) return;
      setFields(loadedFields.map((field) => {
        const target = collections.find((entry) => entry.collection === lookups[field.field]?.targetCollection);
        return target?.name && (!field.name || field.name === field.field) ? { ...field, name: target.name } : field;
      }));
      setCapabilities(capabilityResponse.data);
      setRelationLookups(lookups);
      setNestedRelations(discoveredNested.map((relation) => {
        const target = collections.find((entry) => entry.collection === (relation.targetCollection || relation.childCollection));
        return target?.name && relation.alias === target.collection ? { ...relation, alias: target.name } : relation;
      }));
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

  async function loadItems(target = collection, targetFields = fields, targetNestedRelations = nestedRelations) {
    if (!target || targetFields.length === 0) return;
    const version = ++requestVersion.current;
    setItemsLoading(true);
    setError('');
    try {
      const primaryKey = primaryKeyFieldForFields(targetFields);
      let matchedParentIds = null;
      if (search && targetNestedRelations.length > 0) {
        matchedParentIds = await searchNestedParentIds(targetNestedRelations, search, { request: apiRequest });
        if (version !== requestVersion.current) return;
      }
      const path = buildItemsPath({
        collection: target,
        fields: targetFields,
        search,
        matchedParentIds,
        filters,
        sortField,
        sortDirection,
        limit: pageSize,
        offset,
      });
      const response = await editRequest(apiRequest)(path);
      if (version !== requestVersion.current) return;
      const nextItems = (response?.data ?? []).map((item) => normalizeRecordPrimaryKey(item, primaryKey));
      const capabilityIds = nextItems.map((item) => item.id).filter((id) => id != null && id !== '');
      const [access, summaries] = await Promise.all([
        apiRequest(`/studio-navigation/collections/${encodeURIComponent(target)}/capabilities?ids=${encodeURIComponent(JSON.stringify(capabilityIds))}`),
        targetNestedRelations.length > 0
          ? loadNestedSummariesForItems(targetNestedRelations, nextItems, { request: apiRequest })
          : Promise.resolve({}),
      ]);
      if (version !== requestVersion.current) return;
      setCapabilities(current => ({ ...access.data, records: { ...current?.records, ...access.data.records } }));
      setItems(nextItems);
      setNestedSummaries(summaries);
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
  }, [collection, locale, collectionLabelVersion]);

  useEffect(() => {
    if (route.view !== 'record' || !collection || !route.recordId) {
      return;
    }
    const requestKey = `${collection}:${route.recordId}`;
    let cancelled = false;
    setEditingRecord(null);
    setLoadedRecordKey('');
    setError('');
    editRequest(apiRequest)(`/items/${encodeURIComponent(collection)}/${encodeURIComponent(route.recordId)}`)
      .then((response) => { if (!cancelled) setEditingRecord(response?.data ? { id: route.recordId, ...response.data } : null); })
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
    if (!collection || route.view !== 'record' || !route.recordId) return;
    let active = true;
    apiRequest(`/studio-navigation/collections/${encodeURIComponent(collection)}/capabilities?ids=${encodeURIComponent(JSON.stringify([route.recordId]))}`)
      .then(response => { if (active) setCapabilities(current => ({ ...response.data, records: { ...current?.records, ...response.data.records } })); }).catch(() => { if (active) setCapabilities(null); });
    return () => { active = false; };
  }, [collection, route.view, route.recordId, fields]);

  useEffect(() => {
    if (!collection || schemaLoading || schemaLoadingRef.current || fields.length === 0) return;
    loadItems(collection, fields);
  }, [collection, fields, filters, offset, pageSize, schemaLoading, search, sortDirection, sortField]);

  async function removeRecord(record) {
    if (!record?.id || !canWriteContent(capabilities, 'delete', record.id)) return;
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
        { method: 'DELETE', headers: editHeaders(record) },
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
    if (selected.length === 0 || selected.some(record => !canWriteContent(capabilities, 'delete', record.id))) return;
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
      { method: 'DELETE', headers: editHeaders(record) },
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

  const physicalTableFields = useMemo(() => contentTableFields(fields), [fields]);
  const virtualColumns = useMemo(() => virtualRelationColumns(nestedRelations, t, collections), [nestedRelations, t, collections]);
  const tableFields = useMemo(() => {
    if (virtualColumns.length === 0) return physicalTableFields;
    const idIndex = physicalTableFields.findIndex((field) => field.field === 'id');
    if (idIndex === -1) return [...virtualColumns, ...physicalTableFields];
    return [
      ...physicalTableFields.slice(0, idIndex + 1),
      ...virtualColumns,
      ...physicalTableFields.slice(idIndex + 1),
    ];
  }, [physicalTableFields, virtualColumns]);
  useEffect(() => {
    setVisibleColumnKeys(defaultContentColumnKeys(tableFields, 6, relationLookups));
  }, [tableFields, relationLookups]);
  const visibleTableFields = useMemo(
    () => tableFields.filter((field) => visibleColumnKeys.includes(field.field)),
    [tableFields, visibleColumnKeys],
  );
  const flexibleColumnKey = flexibleContentColumnKey(visibleTableFields, relationLookups);
  const mobileRecordFields = useMemo(() => {
    const preferred = visibleTableFields.filter((field) => field.field !== 'id');
    return (preferred.length > 0 ? preferred : visibleTableFields).slice(0, 4);
  }, [visibleTableFields]);
  const filterableFields = useMemo(() => fields.filter((field) => !field.hidden && field.type !== 'json'), [fields]);
  const selectedFilterField = filterableFields.find((field) => field.field === filterDraft.field) ?? null;
  const filterOperators = operatorsForField(selectedFilterField, relationLookups[filterDraft.field]);
  const hasTextSearch = fields.some((field) => !field.hidden && ['string', 'text'].includes(field.type))
    || nestedRelations.length > 0;
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

  function renderFieldCell(field, record) {
    if (field?.virtualRelation) {
      const rel = field.virtualRelation;
      const rows = nestedSummaries?.[rel.key]?.[String(record.id)] ?? [];
      return (
        <NestedRelationCell
          relation={rel}
          rows={rows}
          files={files}
          t={t}
        />
      );
    }
    if (isFileField(field)) {
      return <FileValuePreview field={field} value={record[field.field]} files={files} t={t} />;
    }
    return renderValue(field, record, relationLookups, t, locale);
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
          historyEnabled={historyEnabled}
          fields={fields}
          capabilities={capabilities}
          relationLookups={relationLookups}
          nestedRelations={nestedRelations}
          files={files}
          record={editing}
          onFileUploaded={registerUploadedFile}
          onCancel={() => onNavigate?.(studioPath.content(collection))}
          onSaved={async () => {
            await loadItems();
            onNavigate?.(studioPath.content(collection));
          }}
        />
        {editing && <ManualFlowActions collection={collection} keys={[editing.id]} onComplete={async () => {
          try {
            const refreshed = (await editRequest(apiRequest)(`/items/${encodeURIComponent(collection)}/${encodeURIComponent(editing.id)}`)).data;
            setEditingRecord(refreshed ? { id: editing.id, ...refreshed } : null);
            await loadItems();
          }
          catch (failure) { if (failure.status === 404) onNavigate?.(studioPath.content(collection)); else throw failure; }
        }} />}
      </div>
    );
  }

  if (!collection) {
    const emptyState = contentEmptyState(visibleCollectionCount);
    return (
      <section className="panel empty-state empty-state-action">
        <div>
          <p className="eyebrow">{t('nav.content')}</p>
          <h2>{t(emptyState.title)}</h2>
          <p>{t(emptyState.description)}</p>
        </div>
        {emptyState.canCreateCollection && onOpenDataModel && (
          <button className="primary-button" type="button" onClick={onOpenDataModel}>{t('content.openDataModel')}</button>
        )}
      </section>
    );
  }

  return (
    <div className="screen-stack">
      <section className="panel toolbar-panel content-toolbar">
        <div className="content-hero-copy">
          <p className="eyebrow">{t('visibility.collection')}</p>
          <h2>{visibleCollectionName}</h2>
          {visibleCollectionName !== collection && <code className="schema-machine-key">{collection}</code>}
          <p>{meta?.total_count != null ? t('content.matchingRecords', { count: meta.total_count }) : t('app.contentDescription')}</p>
        </div>
        <div className="content-hero-side">
          <div className="content-hero-stats" aria-label={t('content.dataControls', { collection: visibleCollectionName })}>
            <span><small>{t('content.records')}</small><strong>{meta?.total_count ?? '—'}</strong></span>
            <span><small>{t('dataModel.fields')}</small><strong>{fields.length}</strong></span>
          </div>
          {canWriteContent(capabilities, 'create') && <button className="primary-button" type="button" onClick={() => onNavigate?.(studioPath.contentNew(collection))}>
            {t('content.newRecord')}
          </button>}
        </div>
      </section>

      <ManualFlowActions collection={collection} keys={Array.from(selectedRecordIds)} onComplete={loadItems} />

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
            {selectedRecordIds.size > 0 && [...selectedRecordIds].every(id => canWriteContent(capabilities, 'delete', id)) && <button className="danger-button" type="button" onClick={removeSelectedRecords}>{t('content.bulkDelete')}</button>}
          </div>
        </div>
      )}
      {schemaLoading ? (
        <section className="panel"><p>{t('content.loadingCollection')}</p></section>
      ) : !itemsLoading && totalCount === 0 && !hasActiveControls ? (
        <section className="panel empty-state empty-state-action">
          <div><h2>{t('content.noRecordsYet')}</h2><p>{t('content.firstRecordDescription', { collection: visibleCollectionName })}</p></div>
          {canWriteContent(capabilities, 'create') && <button className="primary-button" type="button" onClick={() => onNavigate?.(studioPath.contentNew(collection))}>{t('content.createFirstRecord')}</button>}
        </section>
      ) : !itemsLoading && totalCount === 0 ? (
        <section className="panel empty-state empty-state-action">
          <div><h2>{t('content.noRecords')}</h2><p>{t('content.noMatchDescription')}</p></div>
          <button className="text-button" type="button" onClick={clearControls}>{t('content.resetView')}</button>
        </section>
      ) : (
        <section className={`table-panel content-table-density-${density} ${visibleTableFields.length <= 2 ? 'content-table-panel-short' : ''} ${itemsLoading ? 'is-loading' : ''}`} aria-busy={itemsLoading}>
          <div className="table-scroll">
            <table className={visibleTableFields.length <= 2 ? 'content-table-short' : undefined}>
              <colgroup><col className="content-selection-column" />{visibleTableFields.map(field => <col key={field.field} className={`content-column-${contentColumnKind(field, relationLookups[field.field])} ${field.field === flexibleColumnKey ? 'content-column-flex' : ''}`} />)}<col className="content-actions-column" /></colgroup>
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
                      className={`content-column-${contentColumnKind(field, relationLookups[field.field])} ${field.field === flexibleColumnKey ? 'content-column-flex' : ''}`}
                      aria-sort={sortField === field.field ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                      title={field.field}
                    >
                      {field.virtualRelation ? (
                        <span>{fieldLabel(field)}</span>
                      ) : (
                        <button className="sort-header-button" type="button" onClick={() => toggleColumnSort(field.field)}>
                          <span>{fieldLabel(field)}</span>
                          <span className="sort-indicator" aria-hidden="true">
                            {sortField === field.field ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                          </span>
                        </button>
                      )}
                    </th>
                  ))}
                  <th className="content-actions-column">{t('common.actions')}</th>
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
                        <td className={`content-column-${contentColumnKind(field, relationLookups[field.field])} ${field.field === flexibleColumnKey ? 'content-column-flex' : ''}`} key={field.field}>
                          {renderFieldCell(field, record)}
                        </td>
                      ))}
                      <td className="row-actions">
                        <TableRowActions actions={[
                          canWriteContent(capabilities, 'update', record.id) && { label: t('content.quickEdit'), icon: 'inspect', onClick: () => setInspectedRecord(record) },
                          canWriteContent(capabilities, 'update', record.id) && { label: t('common.edit'), icon: 'edit', onClick: () => onNavigate?.(studioPath.contentRecord(collection, record.id)) },
                          canWriteContent(capabilities, 'delete', record.id) && { label: t('common.delete'), icon: 'delete', danger: true, onClick: () => removeRecord(record) },
                        ]} />
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
                      <strong>{primaryField ? renderFieldCell(primaryField, record) : record.id}</strong>
                    </div>
                    <code>{record.id}</code>
                  </header>
                  <dl>
                    {mobileRecordFields.slice(1).map((field) => (
                      <div key={field.field}>
                        <dt>{fieldLabel(field)}</dt>
                        <dd>{renderFieldCell(field, record)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mobile-card-actions">
                    {canWriteContent(capabilities, 'update', record.id) && <button className="secondary-button" type="button" onClick={() => setInspectedRecord(record)}>{t('content.quickEdit')}</button>}
                    {canWriteContent(capabilities, 'update', record.id) && <button className="secondary-button" type="button" onClick={() => onNavigate?.(studioPath.contentRecord(collection, record.id))}>{t('common.edit')}</button>}
                    {canWriteContent(capabilities, 'delete', record.id) && <button className="danger-button" type="button" onClick={() => removeRecord(record)}>{t('common.delete')}</button>}
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
        title={visibleCollectionName}
        description={t('content.quickEdit')}
        closeLabel={t('studio.inspectorClose')}
        onClose={async () => { if (await confirmStudioNavigation()) setInspectedRecord(null); }}
      >
        {inspectedRecord && (
          <RecordForm
            compact
            collection={collection}
            collectionLabel={collectionLabel}
            historyEnabled={historyEnabled}
            fields={fields}
            capabilities={capabilities}
            relationLookups={relationLookups}
            nestedRelations={nestedRelations}
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
              if (saved) setInspectedRecord(current => current && String(current.id) === String(saved.id) ? saved : current);
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
