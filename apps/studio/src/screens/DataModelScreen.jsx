import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import { useConfirmDialog } from '../components/DialogProvider.jsx';
import { FieldBuilder } from '../components/FieldBuilder.jsx';
import { Pagination, paginateClientItems } from '../components/Pagination.jsx';
import {
  createEmptyFieldForm,
  fieldCreationPayload,
  fieldDisplayType,
  isFileField,
} from '../field-ui.js';
import { useI18n } from '../i18n.js';

const COLLECTION_SORT_OPTIONS = [
  ['name-asc', 'dataModel.nameAsc'],
  ['name-desc', 'dataModel.nameDesc'],
];

const FIELD_SORT_OPTIONS = [
  ['name-asc', 'dataModel.nameAsc'],
  ['name-desc', 'dataModel.nameDesc'],
  ['type', 'common.type'],
  ['required', 'dataModel.requiredFirst'],
];

const COLLECTION_PAGE_SIZES = [6, 12, 24];
const FIELD_PAGE_SIZES = [10, 20, 50];
const ACCOUNTABILITY_FIELDS = Object.freeze([
  ['created_at', 'collectionBuilder.createdAt', 'collectionBuilder.createdAtHint'],
  ['updated_at', 'collectionBuilder.updatedAt', 'collectionBuilder.updatedAtHint'],
  ['created_by', 'collectionBuilder.createdBy', 'collectionBuilder.createdByHint'],
  ['updated_by', 'collectionBuilder.updatedBy', 'collectionBuilder.updatedByHint'],
]);

function createEmptyCollectionForm() {
  return {
    collection: '',
    note: '',
    systemFields: ACCOUNTABILITY_FIELDS.map(([field]) => field),
  };
}

function parseJson(value) {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

function relationKind(relation) {
  return parseJson(relation?.metadata)?.kind || 'm2o';
}

function fieldSchemaMetadata(field) {
  return parseJson(field?.schema_metadata) ?? {};
}

function isManagedSystemField(field) {
  return fieldSchemaMetadata(field).systemManaged === true;
}

function compareCollections(left, right, sort) {
  const result = String(left.collection || '').localeCompare(String(right.collection || ''));
  return sort === 'name-desc' ? -result : result;
}

function compareFields(left, right, sort) {
  if (sort === 'type') {
    const typeResult = fieldDisplayType(left).localeCompare(fieldDisplayType(right));
    return typeResult || String(left.field || '').localeCompare(String(right.field || ''));
  }
  if (sort === 'required') {
    const requiredResult = Number(Boolean(right.required)) - Number(Boolean(left.required));
    return requiredResult || String(left.field || '').localeCompare(String(right.field || ''));
  }
  const result = String(left.field || '').localeCompare(String(right.field || ''));
  return sort === 'name-desc' ? -result : result;
}

export function DataModelScreen() {
  const { t } = useI18n();
  const requestConfirmation = useConfirmDialog();
  const [collections, setCollections] = useState([]);
  const [selected, setSelected] = useState('');
  const [fields, setFields] = useState([]);
  const [relations, setRelations] = useState([]);
  const [schemaTab, setSchemaTab] = useState('fields');
  const [relationMode, setRelationMode] = useState('m2o');
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [showCreateField, setShowCreateField] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState('');
  const [collectionSort, setCollectionSort] = useState('name-asc');
  const [collectionPage, setCollectionPage] = useState(1);
  const [collectionPageSize, setCollectionPageSize] = useState(12);
  const [systemPage, setSystemPage] = useState(1);
  const [fieldSearch, setFieldSearch] = useState('');
  const [fieldSort, setFieldSort] = useState('name-asc');
  const [fieldPage, setFieldPage] = useState(1);
  const [fieldPageSize, setFieldPageSize] = useState(20);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const [collectionForm, setCollectionForm] = useState(createEmptyCollectionForm);
  const [fieldForm, setFieldForm] = useState(createEmptyFieldForm);
  const [directForm, setDirectForm] = useState({ manyField: '', oneCollection: '', onDelete: 'RESTRICT' });
  const [m2mForm, setM2mForm] = useState({ junctionCollection: '', leftCollection: '', rightCollection: '' });

  async function loadCollections(preferred = selected) {
    setLoading(true);
    setError('');
    try {
      const response = await apiRequest('/schema/collections');
      const rows = response?.data ?? [];
      setCollections(rows);
      const candidate = rows.some((entry) => entry.collection === preferred)
        ? preferred
        : rows.find((entry) => !entry.system)?.collection || rows[0]?.collection || '';
      setSelected(candidate);
    } catch (requestError) {
      setError(requestError.message || t('dataModel.schemaLoadError'));
    } finally {
      setLoading(false);
    }
  }

  async function loadSelected(collection = selected) {
    if (!collection) {
      setFields([]);
      setRelations([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [fieldResponse, relationResponse] = await Promise.all([
        apiRequest(`/schema/collections/${encodeURIComponent(collection)}/fields`),
        apiRequest('/schema/relations'),
      ]);
      setFields(fieldResponse?.data ?? []);
      setRelations(relationResponse?.data ?? []);
    } catch (requestError) {
      setError(requestError.message || t('dataModel.collectionLoadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCollections();
  }, []);

  useEffect(() => {
    setDirectForm({ manyField: '', oneCollection: '', onDelete: 'RESTRICT' });
    setM2mForm({ junctionCollection: '', leftCollection: selected, rightCollection: '' });
    setSchemaTab('fields');
    setRelationMode('m2o');
    setFieldSearch('');
    setFieldSort('name-asc');
    setFieldPage(1);
    setShowCreateField(false);
    setFieldForm(createEmptyFieldForm());
    loadSelected(selected);
  }, [selected]);

  useEffect(() => {
    setCollectionPage(1);
    setSystemPage(1);
  }, [collectionSearch, collectionSort]);

  useEffect(() => {
    setFieldPage(1);
  }, [fieldSearch, fieldSort]);

  const selectedCollection = collections.find((entry) => entry.collection === selected) ?? null;
  const userCollections = useMemo(() => collections.filter((entry) => !entry.system), [collections]);
  const systemCollections = useMemo(() => collections.filter((entry) => entry.system), [collections]);
  const visibleUserCollections = useMemo(() => {
    const query = collectionSearch.trim().toLowerCase();
    return userCollections
      .filter((entry) => !query || [entry.collection, entry.note]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)))
      .slice()
      .sort((left, right) => compareCollections(left, right, collectionSort));
  }, [collectionSearch, collectionSort, userCollections]);
  const visibleSystemCollections = useMemo(() => {
    const query = collectionSearch.trim().toLowerCase();
    return systemCollections
      .filter((entry) => !query || [entry.collection, entry.note]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)))
      .slice()
      .sort((left, right) => compareCollections(left, right, collectionSort));
  }, [collectionSearch, collectionSort, systemCollections]);
  const visibleFields = useMemo(() => {
    const query = fieldSearch.trim().toLowerCase();
    return fields
      .filter((field) => !query || [
        field.field,
        fieldDisplayType(field),
        field.required ? t('common.required') : t('common.optional'),
        isManagedSystemField(field) ? t('collectionBuilder.systemManaged') : '',
      ].some((value) => String(value).toLowerCase().includes(query)))
      .slice()
      .sort((left, right) => compareFields(left, right, fieldSort));
  }, [fieldSearch, fieldSort, fields, t]);

  const pagedCollections = useMemo(() => paginateClientItems(visibleUserCollections, collectionPage, collectionPageSize), [collectionPage, collectionPageSize, visibleUserCollections]);
  const pagedSystemCollections = useMemo(() => paginateClientItems(visibleSystemCollections, systemPage, collectionPageSize), [collectionPageSize, systemPage, visibleSystemCollections]);
  const pagedFields = useMemo(() => paginateClientItems(visibleFields, fieldPage, fieldPageSize), [fieldPage, fieldPageSize, visibleFields]);

  const directRelations = useMemo(() => relations.filter((relation) =>
    relationKind(relation) !== 'm2m'
    && (relation.many_collection === selected || relation.one_collection === selected)), [relations, selected]);
  const m2mJunctions = useMemo(() => {
    const names = [...new Set(relations
      .filter((relation) => relationKind(relation) === 'm2m' && relation.one_collection === selected)
      .map((relation) => relation.junction_collection)
      .filter(Boolean))];
    return names.map((junctionCollection) => ({
      junctionCollection,
      relations: relations.filter((relation) =>
        relation.junction_collection === junctionCollection && relationKind(relation) === 'm2m'),
    }));
  }, [relations, selected]);
  const relationFields = useMemo(() => fields.filter((field) =>
    field.field !== 'id'
    && field.type === 'uuid'
    && !field.readonly
    && !isFileField(field)
    && !isManagedSystemField(field)), [fields]);

  function toggleCollectionSystemField(field) {
    setCollectionForm((current) => ({
      ...current,
      systemFields: current.systemFields.includes(field)
        ? current.systemFields.filter((entry) => entry !== field)
        : [...current.systemFields, field],
    }));
  }

  async function createCollection(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const name = collectionForm.collection.trim();
      await apiRequest('/schema/collections', {
        method: 'POST',
        body: {
          collection: name,
          note: collectionForm.note.trim() || null,
          systemFields: collectionForm.systemFields,
        },
      });
      setCollectionForm(createEmptyCollectionForm());
      setShowCreateCollection(false);
      setCollectionPage(1);
      setNotice(t('dataModel.collectionCreated', { name }));
      await loadCollections(name);
    } catch (requestError) {
      setError(requestError.message || t('dataModel.collectionCreateError'));
    }
  }

  async function deleteCollection() {
    if (!selectedCollection || selectedCollection.system) return;
    const accepted = await requestConfirmation({
      title: t('dataModel.deleteCollection'),
      description: t('dataModel.deleteCollectionDescription', { name: selected }),
      confirmLabel: t('dataModel.deleteCollectionAction'),
      tone: 'danger',
    });
    if (!accepted) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(`/schema/collections/${encodeURIComponent(selected)}?destructive=true`, { method: 'DELETE' });
      setNotice(t('dataModel.collectionDeleted', { name: selected }));
      await loadCollections('');
    } catch (requestError) {
      setError(requestError.message || t('dataModel.collectionDeleteError'));
    }
  }

  async function createField(event) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setNotice('');
    try {
      const body = fieldCreationPayload(fieldForm);
      await apiRequest(`/schema/collections/${encodeURIComponent(selected)}/fields`, { method: 'POST', body });
      setNotice(t('dataModel.fieldAdded', { name: body.field }));
      setFieldForm(createEmptyFieldForm());
      setShowCreateField(false);
      setFieldPage(1);
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || t('dataModel.fieldCreateError'));
    }
  }

  async function deleteField(field) {
    if (field.field === 'id' || isManagedSystemField(field)) return;
    const accepted = await requestConfirmation({
      title: t('dataModel.deleteField'),
      description: t('dataModel.deleteFieldDescription', { collection: selected, field: field.field }),
      confirmLabel: t('dataModel.deleteFieldAction'),
      tone: 'danger',
    });
    if (!accepted) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(
        `/schema/collections/${encodeURIComponent(selected)}/fields/${encodeURIComponent(field.field)}?destructive=true`,
        { method: 'DELETE' },
      );
      setNotice(t('dataModel.fieldDeleted', { name: field.field }));
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || t('dataModel.fieldDeleteError'));
    }
  }

  async function toggleRequired(field) {
    if (field.field === 'id' || field.readonly || isManagedSystemField(field)) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(
        `/schema/collections/${encodeURIComponent(selected)}/fields/${encodeURIComponent(field.field)}/schema`,
        { method: 'PATCH', body: { required: !Boolean(field.required) } },
      );
      setNotice(t('dataModel.fieldUpdated', { name: field.field }));
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || t('dataModel.fieldUpdateError'));
    }
  }

  async function createDirectRelation(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const kind = relationMode === 'o2o' ? 'o2o' : 'm2o';
    try {
      await apiRequest(`/schema/relations/${kind}`, {
        method: 'POST',
        body: {
          manyCollection: selected,
          manyField: directForm.manyField,
          oneCollection: directForm.oneCollection,
          onDelete: directForm.onDelete,
        },
      });
      setNotice(t(kind === 'o2o' ? 'dataModel.o2oCreated' : 'dataModel.relationCreated', {
        collection: selected,
        field: directForm.manyField,
      }));
      setDirectForm({ manyField: '', oneCollection: '', onDelete: 'RESTRICT' });
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || t(kind === 'o2o' ? 'dataModel.o2oCreateError' : 'dataModel.relationCreateError'));
    }
  }

  async function deleteDirectRelation(relation) {
    const kind = relationKind(relation) === 'o2o' ? 'o2o' : 'm2o';
    const accepted = await requestConfirmation({
      title: t('dataModel.deleteRelation'),
      description: t('dataModel.deleteRelationDescription', {
        collection: relation.many_collection,
        field: relation.many_field,
        target: relation.one_collection,
      }),
      confirmLabel: t('dataModel.deleteRelationAction'),
      tone: 'danger',
    });
    if (!accepted) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(
        `/schema/relations/${kind}/${encodeURIComponent(relation.many_collection)}/${encodeURIComponent(relation.many_field)}`,
        { method: 'DELETE' },
      );
      setNotice(t('dataModel.relationDeleted'));
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || t('dataModel.relationDeleteError'));
    }
  }

  async function createM2M(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const junction = m2mForm.junctionCollection.trim();
      await apiRequest('/schema/relations/m2m', {
        method: 'POST',
        body: {
          junctionCollection: junction,
          leftCollection: m2mForm.leftCollection,
          rightCollection: m2mForm.rightCollection,
        },
      });
      setNotice(t('dataModel.junctionCreated', { name: junction }));
      setM2mForm({ junctionCollection: '', leftCollection: selected, rightCollection: '' });
      await loadCollections(selected);
      await loadSelected(selected);
    } catch (requestError) {
      setError(requestError.message || t('dataModel.m2mCreateError'));
    }
  }

  async function deleteM2M(junctionCollection) {
    const accepted = await requestConfirmation({
      title: t('dataModel.deleteM2M'),
      description: t('dataModel.deleteM2MDescription', { name: junctionCollection }),
      confirmLabel: t('dataModel.deleteRelationAction'),
      tone: 'danger',
    });
    if (!accepted) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(
        `/schema/relations/m2m/${encodeURIComponent(junctionCollection)}?destructive=true`,
        { method: 'DELETE' },
      );
      setNotice(t('dataModel.junctionDeleted', { name: junctionCollection }));
      await loadCollections(selected);
      await loadSelected(selected);
    } catch (requestError) {
      setError(requestError.message || t('dataModel.m2mDeleteError'));
    }
  }

  return (
    <div className="screen-stack">
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      <section className="model-layout">
        <aside className="panel form-panel model-sidebar data-model-sidebar">
          <div className="panel-heading model-sidebar-heading">
            <div>
              <p className="eyebrow">{t('nav.dataModel')}</p>
              <h2>{t('dataModel.collections')}</h2>
              <p>{t('dataModel.collectionSummary', { project: userCollections.length, system: systemCollections.length })}</p>
            </div>
            <button className="primary-button" type="button" onClick={() => setShowCreateCollection((value) => !value)}>
              {showCreateCollection ? t('common.cancel') : t('common.create')}
            </button>
          </div>

          {showCreateCollection && (
            <form className="schema-create-card form-stack collection-create-card" onSubmit={createCollection}>
              <div><strong>{t('dataModel.createCollection')}</strong><p>{t('dataModel.createCollectionHint')}</p></div>
              <label className="field-label"><span>{t('common.name')}</span><input value={collectionForm.collection} onChange={(event) => setCollectionForm((current) => ({ ...current, collection: event.target.value }))} placeholder="articles" required autoFocus /></label>
              <label className="field-label"><span>{t('dataModel.description')}</span><input value={collectionForm.note} onChange={(event) => setCollectionForm((current) => ({ ...current, note: event.target.value }))} placeholder={t('dataModel.optionalDescription')} /></label>

              <div className="accountability-builder">
                <div className="accountability-builder-heading">
                  <span>
                    <strong>{t('collectionBuilder.accountability')}</strong>
                    <small>{t('collectionBuilder.recommended')}</small>
                  </span>
                  <p>{t('collectionBuilder.accountabilityHint')}</p>
                </div>
                <div className="accountability-option-list">
                  {ACCOUNTABILITY_FIELDS.map(([field, titleKey, hintKey]) => (
                    <label className={`accountability-option ${collectionForm.systemFields.includes(field) ? 'active' : ''}`} key={field}>
                      <input
                        type="checkbox"
                        checked={collectionForm.systemFields.includes(field)}
                        onChange={() => toggleCollectionSystemField(field)}
                      />
                      <span>
                        <strong>{t(titleKey)}</strong>
                        <code>{field}</code>
                        <small>{t(hintKey)}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-actions collection-create-actions">
                <button className="text-button" type="button" onClick={() => { setShowCreateCollection(false); setCollectionForm(createEmptyCollectionForm()); }}>{t('common.cancel')}</button>
                <button className="primary-button" type="submit">{t('dataModel.createCollection')}</button>
              </div>
            </form>
          )}

          <div className="sidebar-filter-row">
            <label className="field-label"><span>{t('dataModel.findCollection')}</span><input className="sidebar-filter-input" type="search" value={collectionSearch} onChange={(event) => setCollectionSearch(event.target.value)} placeholder={t('visibility.searchPlaceholder')} /></label>
            <label className="field-label"><span>{t('common.sort')}</span><select value={collectionSort} onChange={(event) => setCollectionSort(event.target.value)}>{COLLECTION_SORT_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}</select></label>
          </div>

          <div className="collection-group">
            <div className="collection-group-heading"><small className="collection-group-label">{t('dataModel.projectCollections')}</small><span>{visibleUserCollections.length}</span></div>
            <div className="list-stack collection-list-page">
              {pagedCollections.items.map((entry) => (
                <button className={`list-button collection-list-button ${entry.collection === selected ? 'active' : ''}`} key={entry.collection} type="button" onClick={() => setSelected(entry.collection)}>
                  <span><strong>{entry.collection}</strong>{entry.note && <small>{entry.note}</small>}</span>
                </button>
              ))}
              {userCollections.length === 0 && <p className="muted-line">{t('dataModel.noProjectCollections')}</p>}
              {userCollections.length > 0 && visibleUserCollections.length === 0 && <p className="muted-line">{t('dataModel.noMatchingProject')}</p>}
            </div>
            {visibleUserCollections.length > 0 && (
              <Pagination compact page={pagedCollections.page} pageSize={collectionPageSize} totalItems={visibleUserCollections.length} pageSizeOptions={COLLECTION_PAGE_SIZES} itemLabel={t('dataModel.collectionsLower')} onPageChange={setCollectionPage} onPageSizeChange={(size) => { setCollectionPageSize(size); setCollectionPage(1); setSystemPage(1); }} />
            )}
          </div>

          {systemCollections.length > 0 && (
            <details className="system-collections">
              <summary>{t('dataModel.systemCollectionsCount', { count: visibleSystemCollections.length })}</summary>
              <div className="list-stack collection-list-page">
                {pagedSystemCollections.items.map((entry) => (
                  <button className={`list-button collection-list-button ${entry.collection === selected ? 'active' : ''}`} key={entry.collection} type="button" onClick={() => setSelected(entry.collection)}>
                    <span><strong>{entry.collection}</strong><small>{t('dataModel.systemManaged')}</small></span>
                  </button>
                ))}
                {visibleSystemCollections.length === 0 && <p className="muted-line">{t('dataModel.noMatchingSystem')}</p>}
              </div>
              {visibleSystemCollections.length > collectionPageSize && (
                <Pagination compact page={pagedSystemCollections.page} pageSize={collectionPageSize} totalItems={visibleSystemCollections.length} pageSizeOptions={COLLECTION_PAGE_SIZES} itemLabel={t('dataModel.systemCollectionsLower')} onPageChange={setSystemPage} />
              )}
            </details>
          )}
        </aside>

        <div className="model-detail-stack">
          {!selectedCollection ? (
            <section className="panel empty-state"><div><h2>{t('dataModel.selectCollection')}</h2><p>{t('dataModel.selectCollectionDescription')}</p></div></section>
          ) : (
            <section className="panel form-panel model-detail">
              <div className="panel-heading model-detail-heading">
                <div>
                  <p className="eyebrow">{selectedCollection.system ? t('dataModel.systemCollection') : t('visibility.collection')}</p>
                  <h2>{selected}</h2>
                  <p>{selectedCollection.note || t('dataModel.noDescription')}</p>
                </div>
                <div className="model-heading-actions">
                  <span className="schema-count">{t('dataModel.fieldCount', { count: fields.length })}</span>
                  {!selectedCollection.system && <button className="danger-button" type="button" onClick={deleteCollection}>{t('dataModel.deleteCollectionAction')}</button>}
                </div>
              </div>

              <div className="segmented-control schema-tabs" aria-label={t('dataModel.collectionSettings')}>
                <button className={schemaTab === 'fields' ? 'active' : ''} type="button" onClick={() => setSchemaTab('fields')}>{t('dataModel.fields')}</button>
                <button className={schemaTab === 'relations' ? 'active' : ''} type="button" onClick={() => setSchemaTab('relations')}>{t('dataModel.relations')}</button>
              </div>

              {schemaTab === 'fields' ? (
                <div className="schema-tab-content">
                  <div className="schema-section-heading">
                    <div><h3>{t('dataModel.fields')}</h3><p>{t('dataModel.fieldsDescription')}</p></div>
                    {!selectedCollection.system && !showCreateField && <button className="primary-button" type="button" onClick={() => setShowCreateField(true)}>{t('dataModel.addField')}</button>}
                  </div>

                  {showCreateField && !selectedCollection.system && (
                    <FieldBuilder
                      form={fieldForm}
                      setForm={setFieldForm}
                      onSubmit={createField}
                      onCancel={() => {
                        setShowCreateField(false);
                        setFieldForm(createEmptyFieldForm());
                      }}
                    />
                  )}

                  <div className="field-list-controls">
                    <label className="field-label"><span>{t('dataModel.findField')}</span><input type="search" value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder={t('dataModel.fieldSearchPlaceholder')} /></label>
                    <label className="field-label"><span>{t('dataModel.sortFields')}</span><select value={fieldSort} onChange={(event) => setFieldSort(event.target.value)}>{FIELD_SORT_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}</select></label>
                    {(fieldSearch || fieldSort !== 'name-asc') && <button className="text-button" type="button" onClick={() => { setFieldSearch(''); setFieldSort('name-asc'); }}>{t('common.reset')}</button>}
                  </div>

                  <div className="field-list">
                    {pagedFields.items.map((field) => {
                      const displayType = fieldDisplayType(field);
                      const metadata = fieldSchemaMetadata(field);
                      const managed = metadata.systemManaged === true;
                      return (
                        <div className={`field-row ${managed ? 'system-managed-field' : ''}`} key={field.field}>
                          <div className="field-row-main">
                            <span className="field-icon" aria-hidden="true">{displayType === 'image' ? '▧' : displayType === 'file' ? '⌑' : String(displayType || '?').slice(0, 1).toUpperCase()}</span>
                            <span className="field-name-stack">
                              <strong>{field.field}</strong>
                              <small>{t(`fieldType.${displayType}`)}{metadata.defaultPreset === 'now' ? ` · ${t('fieldBuilder.currentTime')}` : ''}</small>
                            </span>
                          </div>
                          <div className="field-row-meta">
                            {managed && <span className="status-pill system-field-pill">{t('collectionBuilder.systemManaged')}</span>}
                            <span className={`status-pill ${field.required ? 'required' : ''}`}>{field.required ? t('common.required') : t('common.optional')}</span>
                            {field.readonly && <span className="status-pill">{t('common.readonly')}</span>}
                            {metadata.autoUpdate === true && <span className="status-pill">{t('fieldBuilder.autoUpdate')}</span>}
                            {field.field !== 'id' && !field.readonly && !managed && !selectedCollection.system && (
                              <>
                                <button className="text-button" type="button" onClick={() => toggleRequired(field)}>{field.required ? t('dataModel.makeOptional') : t('dataModel.makeRequired')}</button>
                                <button className="danger-button" type="button" onClick={() => deleteField(field)}>{t('common.delete')}</button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {fields.length > 0 && visibleFields.length === 0 && <div className="inline-info">{t('dataModel.noFields')}</div>}
                  </div>
                  {visibleFields.length > 0 && (
                    <Pagination page={pagedFields.page} pageSize={fieldPageSize} totalItems={visibleFields.length} pageSizeOptions={FIELD_PAGE_SIZES} itemLabel={t('dataModel.fieldsLower')} onPageChange={setFieldPage} onPageSizeChange={(size) => { setFieldPageSize(size); setFieldPage(1); }} />
                  )}
                </div>
              ) : (
                <div className="schema-tab-content">
                  {selectedCollection.system ? (
                    <div className="inline-info">{t('dataModel.systemRelationInfo')}</div>
                  ) : (
                    <>
                      <div className="relation-type-picker" role="tablist" aria-label={t('dataModel.relationType')}>
                        {[
                          ['m2o', 'dataModel.manyToOne', 'dataModel.m2oShort'],
                          ['o2o', 'dataModel.oneToOne', 'dataModel.o2oShort'],
                          ['m2m', 'dataModel.manyToMany', 'dataModel.m2mShort'],
                        ].map(([value, titleKey, descriptionKey]) => (
                          <button key={value} className={`relation-type-card ${relationMode === value ? 'active' : ''}`} type="button" role="tab" aria-selected={relationMode === value} onClick={() => setRelationMode(value)}>
                            <strong>{t(titleKey)}</strong>
                            <small>{t(descriptionKey)}</small>
                          </button>
                        ))}
                      </div>

                      <div className="relation-existing-panel">
                        <div className="schema-section-heading"><div><h3>{t('dataModel.existingRelations')}</h3><p>{t('dataModel.existingRelationsHint')}</p></div></div>
                        <div className="list-stack relation-list">
                          {directRelations.length === 0 && m2mJunctions.length === 0 && <p className="muted-line">{t('dataModel.noRelations')}</p>}
                          {directRelations.map((relation) => {
                            const kind = relationKind(relation);
                            return (
                              <div className="relation-row relation-summary-row" key={`${relation.many_collection}.${relation.many_field}`}>
                                <div>
                                  <span className="status-pill relation-kind-pill">{kind === 'o2o' ? 'O2O' : 'M2O'}</span>
                                  <strong>{relation.many_collection}.{relation.many_field}</strong>
                                  <small>{t('dataModel.linksTo', { collection: relation.one_collection, field: relation.one_field })}</small>
                                </div>
                                <button className="danger-button" type="button" onClick={() => deleteDirectRelation(relation)}>{t('common.delete')}</button>
                              </div>
                            );
                          })}
                          {m2mJunctions.map((junction) => (
                            <div className="relation-row relation-summary-row" key={junction.junctionCollection}>
                              <div>
                                <span className="status-pill relation-kind-pill">M2M</span>
                                <strong>{junction.junctionCollection}</strong>
                                <small>{junction.relations.map((relation) => relation.one_collection).join(' ↔ ')}</small>
                              </div>
                              <button className="danger-button" type="button" onClick={() => deleteM2M(junction.junctionCollection)}>{t('common.delete')}</button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {relationMode === 'm2m' ? (
                        <form className="schema-create-card form-stack relation-create-card" onSubmit={createM2M}>
                          <div><p className="eyebrow">{t('dataModel.manyToMany')}</p><h3>{t('dataModel.connectCollections')}</h3><p>{t('dataModel.m2mDescription')}</p></div>
                          <div className="form-grid relation-form-grid">
                            <label className="field-label"><span>{t('dataModel.junctionName')}</span><input value={m2mForm.junctionCollection} onChange={(event) => setM2mForm((current) => ({ ...current, junctionCollection: event.target.value }))} placeholder="article_tags" required /></label>
                            <label className="field-label"><span>{t('dataModel.firstCollection')}</span><select value={m2mForm.leftCollection} onChange={(event) => setM2mForm((current) => ({ ...current, leftCollection: event.target.value }))} required><option value="">{t('dataModel.chooseCollection')}</option>{userCollections.map((entry) => <option key={entry.collection} value={entry.collection}>{entry.collection}</option>)}</select></label>
                            <label className="field-label"><span>{t('dataModel.secondCollection')}</span><select value={m2mForm.rightCollection} onChange={(event) => setM2mForm((current) => ({ ...current, rightCollection: event.target.value }))} required><option value="">{t('dataModel.chooseCollection')}</option>{userCollections.map((entry) => <option key={entry.collection} value={entry.collection}>{entry.collection}</option>)}</select></label>
                          </div>
                          <div className="form-actions"><button className="primary-button" type="submit">{t('dataModel.createJunction')}</button></div>
                        </form>
                      ) : (
                        <form className="schema-create-card form-stack relation-create-card" onSubmit={createDirectRelation}>
                          <div>
                            <p className="eyebrow">{t(relationMode === 'o2o' ? 'dataModel.oneToOne' : 'dataModel.manyToOne')}</p>
                            <h3>{t(relationMode === 'o2o' ? 'dataModel.connectOneToOne' : 'dataModel.linkOneRecord')}</h3>
                            <p>{t(relationMode === 'o2o' ? 'dataModel.o2oDescription' : 'dataModel.m2oDescription', { collection: selected })}</p>
                          </div>
                          {relationFields.length === 0 && <div className="inline-info">{t('dataModel.relationUuidHint')}</div>}
                          <div className="form-grid relation-form-grid">
                            <label className="field-label"><span>{t('dataModel.fieldIn', { collection: selected })}</span><select value={directForm.manyField} onChange={(event) => setDirectForm((current) => ({ ...current, manyField: event.target.value }))} required><option value="">{t('dataModel.chooseField')}</option>{relationFields.map((field) => <option key={field.field} value={field.field}>{field.field}</option>)}</select></label>
                            <label className="field-label"><span>{t('dataModel.targetCollection')}</span><select value={directForm.oneCollection} onChange={(event) => setDirectForm((current) => ({ ...current, oneCollection: event.target.value }))} required><option value="">{t('dataModel.chooseCollection')}</option>{userCollections.map((entry) => <option key={entry.collection} value={entry.collection}>{entry.collection}</option>)}</select></label>
                            <label className="field-label"><span>{t('dataModel.ifTargetDeleted')}</span><select value={directForm.onDelete} onChange={(event) => setDirectForm((current) => ({ ...current, onDelete: event.target.value }))}><option value="RESTRICT">{t('dataModel.preventDeletion')}</option><option value="CASCADE">{t('dataModel.deleteLinked')}</option><option value="SET NULL">{t('dataModel.clearField')}</option></select></label>
                          </div>
                          <div className="form-actions"><button className="primary-button" type="submit" disabled={relationFields.length === 0}>{t(relationMode === 'o2o' ? 'dataModel.createO2O' : 'dataModel.createRelation')}</button></div>
                        </form>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </section>

      {loading && <div className="muted-line">{t('dataModel.loadingSchema')}</div>}
    </div>
  );
}