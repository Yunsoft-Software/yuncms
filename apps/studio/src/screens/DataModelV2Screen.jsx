import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import { collectionMetadataPatch, collectionUi, parseCollectionMetadata } from '../collection-ui.js';
import { CollectionIcon } from '../components/CollectionIcon.jsx';
import { CollectionIconPicker } from '../components/CollectionIconPicker.jsx';
import { useConfirmDialog } from '../components/DialogProvider.jsx';
import { FieldBuilder } from '../components/FieldBuilder.jsx';
import {
  createEmptyFieldForm,
  fieldCreationPayload,
  fieldDisplayType,
  isFileField,
} from '../field-ui.js';
import { useI18n } from '../i18n.js';

const ACCOUNTABILITY_FIELDS = Object.freeze([
  ['created_at', 'collectionBuilder.createdAt', 'collectionBuilder.createdAtHint'],
  ['updated_at', 'collectionBuilder.updatedAt', 'collectionBuilder.updatedAtHint'],
  ['created_by', 'collectionBuilder.createdBy', 'collectionBuilder.createdByHint'],
  ['updated_by', 'collectionBuilder.updatedBy', 'collectionBuilder.updatedByHint'],
]);

function json(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) ?? {}; } catch { return {}; }
}

function relationKind(relation) {
  return json(relation?.metadata).kind || 'm2o';
}

function fieldMetadata(field) {
  return json(field?.schema_metadata);
}

function isManagedField(field) {
  return fieldMetadata(field).systemManaged === true;
}

function isSystemExtension(field) {
  return fieldMetadata(field).systemExtension === true;
}

function emptyCollectionForm(nextSort = 10) {
  return {
    collection: '',
    note: '',
    icon: 'collection',
    visible: true,
    sort: nextSort,
    systemFields: ACCOUNTABILITY_FIELDS.map(([field]) => field),
  };
}

export function DataModelV2Screen({ onCollectionsChanged }) {
  const { t } = useI18n();
  const confirm = useConfirmDialog();
  const [collections, setCollections] = useState([]);
  const [selected, setSelected] = useState('');
  const [fields, setFields] = useState([]);
  const [relations, setRelations] = useState([]);
  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [showCreateField, setShowCreateField] = useState(false);
  const [collectionForm, setCollectionForm] = useState(() => emptyCollectionForm());
  const [fieldForm, setFieldForm] = useState(createEmptyFieldForm);
  const [overview, setOverview] = useState({ note: '', icon: 'collection', visible: true });
  const [relationMode, setRelationMode] = useState('m2o');
  const [directForm, setDirectForm] = useState({ manyField: '', oneCollection: '', onDelete: 'RESTRICT' });
  const [m2mForm, setM2mForm] = useState({ junctionCollection: '', leftCollection: '', rightCollection: '' });

  const projectCollections = useMemo(() => collections
    .filter((entry) => !entry.system)
    .slice()
    .sort((a, b) => collectionUi(a).sort - collectionUi(b).sort || a.collection.localeCompare(b.collection)), [collections]);
  const systemCollections = useMemo(() => collections
    .filter((entry) => entry.system)
    .slice()
    .sort((a, b) => a.collection.localeCompare(b.collection)), [collections]);
  const selectedCollection = collections.find((entry) => entry.collection === selected) ?? null;

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projectCollections.filter((entry) => !query || [entry.collection, entry.note]
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
  }, [projectCollections, search]);
  const filteredSystems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return systemCollections.filter((entry) => !query || [entry.collection, entry.note]
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
  }, [systemCollections, search]);

  const visibleFields = useMemo(() => {
    const query = fieldSearch.trim().toLowerCase();
    return fields.filter((field) => !query || [field.field, fieldDisplayType(field)]
      .some((value) => String(value).toLowerCase().includes(query)));
  }, [fields, fieldSearch]);

  const relationFields = useMemo(() => fields.filter((field) =>
    field.field !== 'id'
    && field.type === 'uuid'
    && !field.readonly
    && !isFileField(field)
    && !isManagedField(field)), [fields]);

  const directRelations = useMemo(() => relations.filter((relation) =>
    relationKind(relation) !== 'm2m'
    && (relation.many_collection === selected || relation.one_collection === selected)), [relations, selected]);
  const m2mGroups = useMemo(() => {
    const names = [...new Set(relations
      .filter((relation) => relationKind(relation) === 'm2m' && relation.one_collection === selected)
      .map((relation) => relation.junction_collection)
      .filter(Boolean))];
    return names.map((name) => ({
      name,
      rows: relations.filter((relation) => relation.junction_collection === name && relationKind(relation) === 'm2m'),
    }));
  }, [relations, selected]);

  async function loadCollections(preferred = selected) {
    setLoading(true);
    try {
      const response = await apiRequest('/schema/collections');
      const rows = response?.data ?? [];
      setCollections(rows);
      const next = rows.some((entry) => entry.collection === preferred)
        ? preferred
        : rows.find((entry) => !entry.system)?.collection || rows[0]?.collection || '';
      setSelected(next);
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
    try {
      const [fieldResponse, relationResponse] = await Promise.all([
        apiRequest(`/schema/collections/${encodeURIComponent(collection)}/fields`),
        apiRequest('/schema/relations'),
      ]);
      setFields(fieldResponse?.data ?? []);
      setRelations(relationResponse?.data ?? []);
    } catch (requestError) {
      setError(requestError.message || t('dataModel.collectionLoadError'));
    }
  }

  useEffect(() => { loadCollections(); }, []);

  useEffect(() => {
    if (!selectedCollection) return;
    const ui = collectionUi(selectedCollection);
    setOverview({
      note: selectedCollection.note || '',
      icon: ui.icon,
      visible: !selectedCollection.hidden,
    });
    setTab('overview');
    setFieldSearch('');
    setShowCreateField(false);
    setFieldForm(createEmptyFieldForm());
    setRelationMode('m2o');
    setDirectForm({ manyField: '', oneCollection: '', onDelete: 'RESTRICT' });
    setM2mForm({ junctionCollection: '', leftCollection: selected, rightCollection: '' });
    loadSelected(selected);
  }, [selected]);

  function flash(message) {
    setNotice(message);
    setError('');
  }

  async function notifyCollectionsChanged(preferred = selected) {
    await loadCollections(preferred);
    await onCollectionsChanged?.();
  }

  async function createCollection(event) {
    event.preventDefault();
    setError('');
    try {
      const name = collectionForm.collection.trim();
      await apiRequest('/schema/collections', {
        method: 'POST',
        body: {
          collection: name,
          note: collectionForm.note.trim() || null,
          hidden: !collectionForm.visible,
          metadata: { icon: collectionForm.icon, sort: Number(collectionForm.sort) || 10 },
          systemFields: collectionForm.systemFields,
        },
      });
      setShowCreateCollection(false);
      setCollectionForm(emptyCollectionForm((projectCollections.length + 1) * 10));
      flash(t('dataModel.collectionCreated', { name }));
      await notifyCollectionsChanged(name);
    } catch (requestError) {
      setError(requestError.message || t('dataModel.collectionCreateError'));
    }
  }

  async function saveOverview() {
    if (!selectedCollection || selectedCollection.system) return;
    setError('');
    try {
      const metadata = collectionMetadataPatch(selectedCollection, {
        icon: overview.icon,
        sort: collectionUi(selectedCollection).sort,
      });
      await apiRequest(`/schema/collections/${encodeURIComponent(selected)}`, {
        method: 'PATCH',
        body: {
          note: overview.note.trim() || null,
          hidden: !overview.visible,
          metadata,
        },
      });
      flash(t('dataModel.collectionSettingsSaved'));
      await notifyCollectionsChanged(selected);
    } catch (requestError) {
      setError(requestError.message || t('dataModel.collectionSettingsError'));
    }
  }

  async function moveCollection(direction) {
    const index = projectCollections.findIndex((entry) => entry.collection === selected);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= projectCollections.length) return;
    const current = projectCollections[index];
    const target = projectCollections[targetIndex];
    const currentSort = collectionUi(current).sort;
    const targetSort = collectionUi(target).sort;
    try {
      await apiRequest(`/schema/collections/${encodeURIComponent(current.collection)}`, {
        method: 'PATCH',
        body: { metadata: collectionMetadataPatch(current, { sort: targetSort }) },
      });
      await apiRequest(`/schema/collections/${encodeURIComponent(target.collection)}`, {
        method: 'PATCH',
        body: { metadata: collectionMetadataPatch(target, { sort: currentSort }) },
      });
      flash(t('dataModel.navigationOrderSaved'));
      await notifyCollectionsChanged(selected);
    } catch (requestError) {
      setError(requestError.message || t('dataModel.navigationOrderError'));
    }
  }

  async function deleteCollection() {
    if (!selectedCollection || selectedCollection.system) return;
    const accepted = await confirm({
      title: t('dataModel.deleteCollection'),
      description: t('dataModel.deleteCollectionDescription', { name: selected }),
      confirmLabel: t('dataModel.deleteCollectionAction'),
      tone: 'danger',
    });
    if (!accepted) return;
    try {
      await apiRequest(`/schema/collections/${encodeURIComponent(selected)}?destructive=true`, { method: 'DELETE' });
      flash(t('dataModel.collectionDeleted', { name: selected }));
      await notifyCollectionsChanged('');
    } catch (requestError) {
      setError(requestError.message || t('dataModel.collectionDeleteError'));
    }
  }

  async function createField(event) {
    event.preventDefault();
    if (!selectedCollection) return;
    try {
      const body = fieldCreationPayload(fieldForm);
      const path = selectedCollection.system
        ? `/schema/system-collections/${encodeURIComponent(selected)}/fields`
        : `/schema/collections/${encodeURIComponent(selected)}/fields`;
      await apiRequest(path, { method: 'POST', body });
      setFieldForm(createEmptyFieldForm());
      setShowCreateField(false);
      flash(t('dataModel.fieldAdded', { name: body.field }));
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || t('dataModel.fieldCreateError'));
    }
  }

  async function toggleRequired(field) {
    if (selectedCollection?.system || field.field === 'id' || field.readonly || isManagedField(field)) return;
    try {
      await apiRequest(
        `/schema/collections/${encodeURIComponent(selected)}/fields/${encodeURIComponent(field.field)}/schema`,
        { method: 'PATCH', body: { required: !Boolean(field.required) } },
      );
      flash(t('dataModel.fieldUpdated', { name: field.field }));
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || t('dataModel.fieldUpdateError'));
    }
  }

  async function deleteField(field) {
    if (selectedCollection?.system || field.field === 'id' || isManagedField(field)) return;
    const accepted = await confirm({
      title: t('dataModel.deleteField'),
      description: t('dataModel.deleteFieldDescription', { collection: selected, field: field.field }),
      confirmLabel: t('dataModel.deleteFieldAction'),
      tone: 'danger',
    });
    if (!accepted) return;
    try {
      await apiRequest(`/schema/collections/${encodeURIComponent(selected)}/fields/${encodeURIComponent(field.field)}?destructive=true`, { method: 'DELETE' });
      flash(t('dataModel.fieldDeleted', { name: field.field }));
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || t('dataModel.fieldDeleteError'));
    }
  }

  async function createDirectRelation(event) {
    event.preventDefault();
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
      flash(t(kind === 'o2o' ? 'dataModel.o2oCreated' : 'dataModel.relationCreated', {
        collection: selected,
        field: directForm.manyField,
      }));
      setDirectForm({ manyField: '', oneCollection: '', onDelete: 'RESTRICT' });
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || t(kind === 'o2o' ? 'dataModel.o2oCreateError' : 'dataModel.relationCreateError'));
    }
  }

  async function createM2M(event) {
    event.preventDefault();
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
      flash(t('dataModel.junctionCreated', { name: junction }));
      setM2mForm({ junctionCollection: '', leftCollection: selected, rightCollection: '' });
      await notifyCollectionsChanged(selected);
      await loadSelected(selected);
    } catch (requestError) {
      setError(requestError.message || t('dataModel.m2mCreateError'));
    }
  }

  function toggleSystemField(field) {
    setCollectionForm((current) => ({
      ...current,
      systemFields: current.systemFields.includes(field)
        ? current.systemFields.filter((item) => item !== field)
        : [...current.systemFields, field],
    }));
  }

  const selectedIndex = projectCollections.findIndex((entry) => entry.collection === selected);

  return (
    <div className="data-model-v2">
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      <div className="data-model-v2-layout">
        <aside className="panel data-model-collections-panel">
          <div className="data-model-collections-heading">
            <div><p className="eyebrow">{t('nav.dataModel')}</p><h2>{t('dataModel.collections')}</h2></div>
            <button className="primary-button" type="button" onClick={() => {
              setCollectionForm(emptyCollectionForm((projectCollections.length + 1) * 10));
              setShowCreateCollection((value) => !value);
            }}>{showCreateCollection ? t('common.close') : t('common.create')}</button>
          </div>

          <label className="field-label data-model-collection-search">
            <span>{t('common.search')}</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('visibility.searchPlaceholder')} />
          </label>

          <div className="data-model-collection-list">
            <small className="data-model-group-label">{t('dataModel.projectCollections')}</small>
            {filteredProjects.map((entry) => (
              <button className={`data-model-collection-item ${selected === entry.collection ? 'active' : ''}`} type="button" key={entry.collection} onClick={() => setSelected(entry.collection)}>
                <CollectionIcon name={collectionUi(entry).icon} />
                <span><strong>{entry.collection}</strong><small>{entry.hidden ? t('dataModel.hiddenFromContent') : entry.note || t('dataModel.visibleInContent')}</small></span>
              </button>
            ))}
            {filteredProjects.length === 0 && <p className="muted-line">{t('dataModel.noProjectCollections')}</p>}

            {filteredSystems.length > 0 && <small className="data-model-group-label system-group-label">{t('dataModel.systemCollections')}</small>}
            {filteredSystems.map((entry) => (
              <button className={`data-model-collection-item system ${selected === entry.collection ? 'active' : ''}`} type="button" key={entry.collection} onClick={() => setSelected(entry.collection)}>
                <CollectionIcon name={entry.collection === 'yuncms_users' ? 'users' : entry.collection === 'yuncms_files' ? 'folder' : entry.collection === 'yuncms_roles' ? 'shield' : 'collection'} />
                <span><strong>{entry.collection}</strong><small>{t('dataModel.systemManaged')}</small></span>
              </button>
            ))}
          </div>
        </aside>

        <main className="data-model-workspace">
          {showCreateCollection ? (
            <section className="panel data-model-create-workspace">
              <div className="workspace-section-heading">
                <div><p className="eyebrow">{t('dataModel.newCollection')}</p><h2>{t('dataModel.createCollection')}</h2><p>{t('dataModel.createCollectionHint')}</p></div>
                <button className="text-button" type="button" onClick={() => setShowCreateCollection(false)}>{t('common.cancel')}</button>
              </div>
              <form className="data-model-create-form" onSubmit={createCollection}>
                <div className="data-model-create-main">
                  <label className="field-label"><span>{t('dataModel.collectionName')}</span><input value={collectionForm.collection} onChange={(event) => setCollectionForm((current) => ({ ...current, collection: event.target.value }))} placeholder="articles" required autoFocus /></label>
                  <label className="field-label"><span>{t('dataModel.description')}</span><input value={collectionForm.note} onChange={(event) => setCollectionForm((current) => ({ ...current, note: event.target.value }))} placeholder={t('dataModel.optionalDescription')} /></label>
                  <label className="collection-visibility-toggle"><input type="checkbox" checked={collectionForm.visible} onChange={(event) => setCollectionForm((current) => ({ ...current, visible: event.target.checked }))} /><span><strong>{t('dataModel.showInContent')}</strong><small>{t('dataModel.showInContentHint')}</small></span></label>
                  <div className="accountability-builder">
                    <div className="accountability-builder-heading"><span><strong>{t('collectionBuilder.accountability')}</strong><small>{t('collectionBuilder.recommended')}</small></span><p>{t('collectionBuilder.accountabilityHint')}</p></div>
                    <div className="accountability-option-list">
                      {ACCOUNTABILITY_FIELDS.map(([field, titleKey, hintKey]) => (
                        <label className={`accountability-option ${collectionForm.systemFields.includes(field) ? 'active' : ''}`} key={field}>
                          <input type="checkbox" checked={collectionForm.systemFields.includes(field)} onChange={() => toggleSystemField(field)} />
                          <span><strong>{t(titleKey)}</strong><code>{field}</code><small>{t(hintKey)}</small></span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <aside className="data-model-create-icon"><CollectionIconPicker value={collectionForm.icon} onChange={(icon) => setCollectionForm((current) => ({ ...current, icon }))} /></aside>
                <div className="form-actions data-model-create-actions"><button className="primary-button" type="submit">{t('dataModel.createCollection')}</button></div>
              </form>
            </section>
          ) : !selectedCollection ? (
            <section className="panel empty-state"><div><h2>{t('dataModel.selectCollection')}</h2><p>{t('dataModel.selectCollectionDescription')}</p></div></section>
          ) : (
            <section className="panel data-model-detail-panel">
              <header className="data-model-detail-heading">
                <div className="data-model-detail-title">
                  <span className="data-model-detail-icon"><CollectionIcon name={selectedCollection.system ? (selected === 'yuncms_users' ? 'users' : selected === 'yuncms_files' ? 'folder' : selected === 'yuncms_roles' ? 'shield' : 'collection') : overview.icon} size={22} /></span>
                  <div><p className="eyebrow">{selectedCollection.system ? t('dataModel.systemCollection') : t('visibility.collection')}</p><h2>{selected}</h2><p>{selectedCollection.note || t('dataModel.noDescription')}</p></div>
                </div>
                <div className="data-model-detail-actions"><span className="schema-count">{t('dataModel.fieldCount', { count: fields.length })}</span>{!selectedCollection.system && <button className="danger-button" type="button" onClick={deleteCollection}>{t('dataModel.deleteCollectionAction')}</button>}</div>
              </header>

              <div className="data-model-tabs" role="tablist">
                {['overview', 'fields', 'relations'].map((name) => (
                  <button type="button" role="tab" aria-selected={tab === name} className={tab === name ? 'active' : ''} key={name} onClick={() => setTab(name)}>{t(`dataModel.tab.${name}`)}</button>
                ))}
              </div>

              {tab === 'overview' && (
                <div className="data-model-tab-panel collection-overview-panel">
                  {selectedCollection.system ? (
                    <div className="system-collection-overview">
                      <div className="inline-info"><strong>{t('dataModel.systemCollection')}</strong><br />{t('dataModel.systemCollectionExtensionHint')}</div>
                      <button className="primary-button" type="button" onClick={() => { setTab('fields'); setShowCreateField(true); }}>{t('dataModel.addCustomSystemField')}</button>
                    </div>
                  ) : (
                    <>
                      <div className="collection-overview-grid">
                        <div className="collection-overview-settings">
                          <label className="field-label"><span>{t('dataModel.description')}</span><textarea rows="4" value={overview.note} onChange={(event) => setOverview((current) => ({ ...current, note: event.target.value }))} placeholder={t('dataModel.optionalDescription')} /></label>
                          <label className="collection-visibility-toggle"><input type="checkbox" checked={overview.visible} onChange={(event) => setOverview((current) => ({ ...current, visible: event.target.checked }))} /><span><strong>{t('dataModel.showInContent')}</strong><small>{t('dataModel.showInContentHint')}</small></span></label>
                          <div className="collection-order-card"><div><strong>{t('dataModel.sidebarOrder')}</strong><small>{t('dataModel.sidebarOrderHint')}</small></div><div className="collection-order-actions"><button className="secondary-button" type="button" disabled={selectedIndex <= 0} onClick={() => moveCollection(-1)}>↑ {t('dataModel.moveUp')}</button><button className="secondary-button" type="button" disabled={selectedIndex < 0 || selectedIndex >= projectCollections.length - 1} onClick={() => moveCollection(1)}>↓ {t('dataModel.moveDown')}</button></div></div>
                          <button className="primary-button collection-overview-save" type="button" onClick={saveOverview}>{t('common.save')}</button>
                        </div>
                        <CollectionIconPicker value={overview.icon} onChange={(icon) => setOverview((current) => ({ ...current, icon }))} />
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab === 'fields' && (
                <div className="data-model-tab-panel fields-workspace">
                  <div className="workspace-section-heading"><div><h3>{t('dataModel.fields')}</h3><p>{selectedCollection.system ? t('dataModel.systemFieldsHint') : t('dataModel.fieldsDescription')}</p></div><button className="primary-button" type="button" onClick={() => setShowCreateField((value) => !value)}>{showCreateField ? t('common.close') : t('dataModel.addField')}</button></div>
                  {showCreateField && <FieldBuilder form={fieldForm} setForm={setFieldForm} onSubmit={createField} onCancel={() => { setShowCreateField(false); setFieldForm(createEmptyFieldForm()); }} />}
                  <label className="field-label field-workspace-search"><span>{t('dataModel.findField')}</span><input type="search" value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder={t('dataModel.fieldSearchPlaceholder')} /></label>
                  <div className="field-workspace-list">
                    {visibleFields.map((field) => {
                      const displayType = fieldDisplayType(field);
                      const metadata = fieldMetadata(field);
                      return (
                        <div className="field-workspace-row" key={field.field}>
                          <span className="field-icon">{String(displayType || '?').slice(0, 1).toUpperCase()}</span>
                          <div className="field-workspace-copy"><strong>{field.field}</strong><small>{t(`fieldType.${displayType}`)}{metadata.defaultPreset === 'now' ? ` · ${t('fieldBuilder.currentTime')}` : ''}</small></div>
                          <div className="field-workspace-badges">
                            {isManagedField(field) && <span className="status-pill system-field-pill">{t('collectionBuilder.systemManaged')}</span>}
                            {isSystemExtension(field) && <span className="status-pill">{t('dataModel.customSystemField')}</span>}
                            <span className="status-pill">{field.required ? t('common.required') : t('common.optional')}</span>
                            {field.readonly && <span className="status-pill">{t('common.readonly')}</span>}
                          </div>
                          {!selectedCollection.system && field.field !== 'id' && !field.readonly && !isManagedField(field) && <div className="field-workspace-actions"><button className="text-button" type="button" onClick={() => toggleRequired(field)}>{field.required ? t('dataModel.makeOptional') : t('dataModel.makeRequired')}</button><button className="danger-button" type="button" onClick={() => deleteField(field)}>{t('common.delete')}</button></div>}
                        </div>
                      );
                    })}
                    {visibleFields.length === 0 && <div className="inline-info">{t('dataModel.noFields')}</div>}
                  </div>
                </div>
              )}

              {tab === 'relations' && (
                <div className="data-model-tab-panel relations-workspace">
                  {selectedCollection.system ? <div className="inline-info">{t('dataModel.systemRelationInfo')}</div> : (
                    <>
                      <div className="relation-type-picker" role="tablist">
                        {[
                          ['m2o', 'dataModel.manyToOne', 'dataModel.m2oShort'],
                          ['o2o', 'dataModel.oneToOne', 'dataModel.o2oShort'],
                          ['m2m', 'dataModel.manyToMany', 'dataModel.m2mShort'],
                        ].map(([value, titleKey, copyKey]) => <button type="button" key={value} className={`relation-type-card ${relationMode === value ? 'active' : ''}`} onClick={() => setRelationMode(value)}><strong>{t(titleKey)}</strong><small>{t(copyKey)}</small></button>)}
                      </div>

                      <div className="relation-existing-panel"><div><h3>{t('dataModel.existingRelations')}</h3><p>{t('dataModel.existingRelationsHint')}</p></div><div className="relation-v2-list">{directRelations.map((relation) => <div className="relation-v2-row" key={`${relation.many_collection}.${relation.many_field}`}><span className="status-pill">{relationKind(relation).toUpperCase()}</span><strong>{relation.many_collection}.{relation.many_field}</strong><small>→ {relation.one_collection}.{relation.one_field}</small></div>)}{m2mGroups.map((group) => <div className="relation-v2-row" key={group.name}><span className="status-pill">M2M</span><strong>{group.name}</strong><small>{group.rows.map((row) => row.one_collection).join(' ↔ ')}</small></div>)}{directRelations.length === 0 && m2mGroups.length === 0 && <p className="muted-line">{t('dataModel.noRelations')}</p>}</div></div>

                      {relationMode === 'm2m' ? (
                        <form className="relation-v2-form" onSubmit={createM2M}><label className="field-label"><span>{t('dataModel.junctionName')}</span><input value={m2mForm.junctionCollection} onChange={(event) => setM2mForm((current) => ({ ...current, junctionCollection: event.target.value }))} placeholder="article_tags" required /></label><label className="field-label"><span>{t('dataModel.firstCollection')}</span><select value={m2mForm.leftCollection} onChange={(event) => setM2mForm((current) => ({ ...current, leftCollection: event.target.value }))} required>{projectCollections.map((entry) => <option key={entry.collection} value={entry.collection}>{entry.collection}</option>)}</select></label><label className="field-label"><span>{t('dataModel.secondCollection')}</span><select value={m2mForm.rightCollection} onChange={(event) => setM2mForm((current) => ({ ...current, rightCollection: event.target.value }))} required><option value="">{t('dataModel.chooseCollection')}</option>{projectCollections.map((entry) => <option key={entry.collection} value={entry.collection}>{entry.collection}</option>)}</select></label><button className="primary-button" type="submit">{t('dataModel.createJunction')}</button></form>
                      ) : (
                        <form className="relation-v2-form" onSubmit={createDirectRelation}><label className="field-label"><span>{t('dataModel.fieldIn', { collection: selected })}</span><select value={directForm.manyField} onChange={(event) => setDirectForm((current) => ({ ...current, manyField: event.target.value }))} required><option value="">{t('dataModel.chooseField')}</option>{relationFields.map((field) => <option key={field.field} value={field.field}>{field.field}</option>)}</select></label><label className="field-label"><span>{t('dataModel.targetCollection')}</span><select value={directForm.oneCollection} onChange={(event) => setDirectForm((current) => ({ ...current, oneCollection: event.target.value }))} required><option value="">{t('dataModel.chooseCollection')}</option>{projectCollections.map((entry) => <option key={entry.collection} value={entry.collection}>{entry.collection}</option>)}</select></label><label className="field-label"><span>{t('dataModel.ifTargetDeleted')}</span><select value={directForm.onDelete} onChange={(event) => setDirectForm((current) => ({ ...current, onDelete: event.target.value }))}><option value="RESTRICT">{t('dataModel.preventDeletion')}</option><option value="CASCADE">{t('dataModel.deleteLinked')}</option><option value="SET NULL">{t('dataModel.clearField')}</option></select></label><button className="primary-button" type="submit" disabled={relationFields.length === 0}>{t(relationMode === 'o2o' ? 'dataModel.createO2O' : 'dataModel.createRelation')}</button></form>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>
          )}
        </main>
      </div>
      {loading && <p className="muted-line">{t('dataModel.loadingSchema')}</p>}
    </div>
  );
}
