import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import { useConfirmDialog } from '../components/DialogProvider.jsx';

const FIELD_TYPES = [
  'string', 'text', 'integer', 'bigint', 'decimal', 'boolean',
  'date', 'datetime', 'timestamp', 'json', 'uuid',
];

const COLLECTION_SORT_OPTIONS = [
  ['name-asc', 'Name A–Z'],
  ['name-desc', 'Name Z–A'],
];

const FIELD_SORT_OPTIONS = [
  ['name-asc', 'Name A–Z'],
  ['name-desc', 'Name Z–A'],
  ['type', 'Type'],
  ['required', 'Required first'],
];

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

function compareCollections(left, right, sort) {
  const result = String(left.collection || '').localeCompare(String(right.collection || ''));
  return sort === 'name-desc' ? -result : result;
}

function compareFields(left, right, sort) {
  if (sort === 'type') {
    const typeResult = String(left.type || '').localeCompare(String(right.type || ''));
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
  const requestConfirmation = useConfirmDialog();
  const [collections, setCollections] = useState([]);
  const [selected, setSelected] = useState('');
  const [fields, setFields] = useState([]);
  const [relations, setRelations] = useState([]);
  const [schemaTab, setSchemaTab] = useState('fields');
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState('');
  const [collectionSort, setCollectionSort] = useState('name-asc');
  const [fieldSearch, setFieldSearch] = useState('');
  const [fieldSort, setFieldSort] = useState('name-asc');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const [collectionForm, setCollectionForm] = useState({ collection: '', note: '' });
  const [fieldForm, setFieldForm] = useState({
    field: '', type: 'string', required: false, length: 255,
  });
  const [m2oForm, setM2oForm] = useState({ manyField: '', oneCollection: '', onDelete: 'RESTRICT' });
  const [m2mForm, setM2mForm] = useState({
    junctionCollection: '', leftCollection: '', rightCollection: '',
  });

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
      setError(requestError.message || 'Schema could not be loaded');
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
      setError(requestError.message || 'Collection schema could not be loaded');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCollections();
  }, []);

  useEffect(() => {
    setM2oForm((current) => ({ ...current, manyField: '', oneCollection: '' }));
    setSchemaTab('fields');
    setFieldSearch('');
    setFieldSort('name-asc');
    loadSelected(selected);
  }, [selected]);

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
      .filter((field) => !query || [field.field, field.type, field.required ? 'required' : 'optional']
        .some((value) => String(value).toLowerCase().includes(query)))
      .slice()
      .sort((left, right) => compareFields(left, right, fieldSort));
  }, [fieldSearch, fieldSort, fields]);
  const m2oRelations = useMemo(() => relations.filter((relation) =>
    relationKind(relation) !== 'm2m' &&
    (relation.many_collection === selected || relation.one_collection === selected)), [relations, selected]);
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

  async function createCollection(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const name = collectionForm.collection.trim();
      await apiRequest('/schema/collections', {
        method: 'POST',
        body: { collection: name, note: collectionForm.note.trim() || null },
      });
      setCollectionForm({ collection: '', note: '' });
      setShowCreateCollection(false);
      setNotice(`Created collection ${name}`);
      await loadCollections(name);
    } catch (requestError) {
      setError(requestError.message || 'Collection could not be created');
    }
  }

  async function deleteCollection() {
    if (!selectedCollection || selectedCollection.system) return;
    const accepted = await requestConfirmation({
      title: 'Delete collection?',
      description: `${selected} and every record it contains will be permanently deleted.`,
      confirmLabel: 'Delete collection',
      tone: 'danger',
    });
    if (!accepted) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(`/schema/collections/${encodeURIComponent(selected)}?destructive=true`, {
        method: 'DELETE',
      });
      setNotice(`Deleted collection ${selected}`);
      await loadCollections('');
    } catch (requestError) {
      setError(requestError.message || 'Collection could not be deleted');
    }
  }

  async function createField(event) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setNotice('');
    try {
      const body = {
        field: fieldForm.field.trim(),
        type: fieldForm.type,
        required: fieldForm.required,
      };
      if (fieldForm.type === 'string') body.length = Number(fieldForm.length || 255);
      await apiRequest(`/schema/collections/${encodeURIComponent(selected)}/fields`, {
        method: 'POST', body,
      });
      setNotice(`Added field ${fieldForm.field.trim()}`);
      setFieldForm({ field: '', type: 'string', required: false, length: 255 });
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || 'Field could not be created');
    }
  }

  async function deleteField(field) {
    if (field.field === 'id') return;
    const accepted = await requestConfirmation({
      title: 'Delete field?',
      description: `${selected}.${field.field} and all values stored in it will be permanently deleted.`,
      confirmLabel: 'Delete field',
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
      setNotice(`Deleted field ${field.field}`);
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || 'Field could not be deleted');
    }
  }

  async function toggleRequired(field) {
    if (field.field === 'id') return;
    setError('');
    setNotice('');
    try {
      await apiRequest(
        `/schema/collections/${encodeURIComponent(selected)}/fields/${encodeURIComponent(field.field)}/schema`,
        { method: 'PATCH', body: { required: !Boolean(field.required) } },
      );
      setNotice(`Updated ${field.field}`);
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || 'Field schema could not be updated');
    }
  }

  async function createM2O(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await apiRequest('/schema/relations/m2o', {
        method: 'POST',
        body: {
          manyCollection: selected,
          manyField: m2oForm.manyField,
          oneCollection: m2oForm.oneCollection,
          onDelete: m2oForm.onDelete,
        },
      });
      setNotice(`Created relation ${selected}.${m2oForm.manyField}`);
      setM2oForm({ manyField: '', oneCollection: '', onDelete: 'RESTRICT' });
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || 'Relation could not be created');
    }
  }

  async function deleteM2O(relation) {
    const accepted = await requestConfirmation({
      title: 'Delete relation?',
      description: `${relation.many_collection}.${relation.many_field} will no longer reference ${relation.one_collection}.`,
      confirmLabel: 'Delete relation',
      tone: 'danger',
    });
    if (!accepted) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(
        `/schema/relations/m2o/${encodeURIComponent(relation.many_collection)}/${encodeURIComponent(relation.many_field)}`,
        { method: 'DELETE' },
      );
      setNotice('Relation deleted');
      await loadSelected();
    } catch (requestError) {
      setError(requestError.message || 'Relation could not be deleted');
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
      setNotice(`Created M2M junction ${junction}`);
      setM2mForm({ junctionCollection: '', leftCollection: '', rightCollection: '' });
      await loadCollections(selected);
      await loadSelected(selected);
    } catch (requestError) {
      setError(requestError.message || 'M2M relation could not be created');
    }
  }

  async function deleteM2M(junctionCollection) {
    const accepted = await requestConfirmation({
      title: 'Delete many-to-many relation?',
      description: `${junctionCollection} and every link record it contains will be permanently deleted.`,
      confirmLabel: 'Delete relation',
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
      setNotice(`Deleted M2M junction ${junctionCollection}`);
      await loadCollections(selected);
      await loadSelected(selected);
    } catch (requestError) {
      setError(requestError.message || 'M2M relation could not be deleted');
    }
  }

  return (
    <div className="screen-stack">
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      <section className="model-layout">
        <aside className="panel form-panel model-sidebar">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Data Model</p>
              <h2>Collections</h2>
              <p>Choose a collection to edit its structure.</p>
            </div>
            <button className="primary-button" type="button" onClick={() => setShowCreateCollection((value) => !value)}>
              {showCreateCollection ? 'Cancel' : 'New collection'}
            </button>
          </div>

          {showCreateCollection && (
            <form className="schema-create-card form-stack compact" onSubmit={createCollection}>
              <div>
                <strong>Create collection</strong>
                <p>Use a short machine-friendly name such as `articles` or `customers`.</p>
              </div>
              <label className="field-label">
                <span>Name</span>
                <input
                  value={collectionForm.collection}
                  onChange={(event) => setCollectionForm((current) => ({ ...current, collection: event.target.value }))}
                  placeholder="articles"
                  required
                  autoFocus
                />
              </label>
              <label className="field-label">
                <span>Description</span>
                <input
                  value={collectionForm.note}
                  onChange={(event) => setCollectionForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder="Optional description"
                />
              </label>
              <button className="primary-button" type="submit">Create</button>
            </form>
          )}

          <div className="sidebar-filter-row">
            <label className="field-label">
              <span>Find collection</span>
              <input
                className="sidebar-filter-input"
                type="search"
                value={collectionSearch}
                onChange={(event) => setCollectionSearch(event.target.value)}
                placeholder="Name or description…"
              />
            </label>
            <label className="field-label">
              <span>Sort</span>
              <select value={collectionSort} onChange={(event) => setCollectionSort(event.target.value)}>
                {COLLECTION_SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>

          <div className="collection-group">
            <small className="collection-group-label">
              Project collections · {visibleUserCollections.length}/{userCollections.length}
            </small>
            <div className="list-stack">
              {visibleUserCollections.map((entry) => (
                <button
                  className={`list-button collection-list-button ${entry.collection === selected ? 'active' : ''}`}
                  key={entry.collection}
                  type="button"
                  onClick={() => setSelected(entry.collection)}
                >
                  <span>
                    <strong>{entry.collection}</strong>
                    {entry.note && <small>{entry.note}</small>}
                  </span>
                </button>
              ))}
              {userCollections.length === 0 && <p className="muted-line">No project collections yet.</p>}
              {userCollections.length > 0 && visibleUserCollections.length === 0 && <p className="muted-line">No matching project collections.</p>}
            </div>
          </div>

          {systemCollections.length > 0 && (
            <details className="system-collections">
              <summary>System collections ({visibleSystemCollections.length}/{systemCollections.length})</summary>
              <div className="list-stack">
                {visibleSystemCollections.map((entry) => (
                  <button
                    className={`list-button collection-list-button ${entry.collection === selected ? 'active' : ''}`}
                    key={entry.collection}
                    type="button"
                    onClick={() => setSelected(entry.collection)}
                  >
                    <span><strong>{entry.collection}</strong><small>system managed</small></span>
                  </button>
                ))}
                {visibleSystemCollections.length === 0 && <p className="muted-line">No matching system collections.</p>}
              </div>
            </details>
          )}
        </aside>

        <div className="model-detail-stack">
          {!selectedCollection ? (
            <section className="panel empty-state">
              <div><h2>Select a collection</h2><p>Choose a collection on the left to inspect its fields and relations.</p></div>
            </section>
          ) : (
            <section className="panel form-panel model-detail">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">{selectedCollection.system ? 'System collection' : 'Collection'}</p>
                  <h2>{selected}</h2>
                  <p>{selectedCollection.note || 'No description has been added.'}</p>
                </div>
                {!selectedCollection.system && (
                  <button className="danger-button" type="button" onClick={deleteCollection}>Delete collection</button>
                )}
              </div>

              <div className="segmented-control schema-tabs" aria-label="Collection settings">
                <button className={schemaTab === 'fields' ? 'active' : ''} type="button" onClick={() => setSchemaTab('fields')}>Fields</button>
                <button className={schemaTab === 'relations' ? 'active' : ''} type="button" onClick={() => setSchemaTab('relations')}>Relations</button>
              </div>

              {schemaTab === 'fields' ? (
                <div className="schema-tab-content">
                  <div className="schema-section-heading">
                    <div>
                      <h3>Fields</h3>
                      <p>Fields define what data each record can store.</p>
                    </div>
                    <span className="schema-count">{visibleFields.length}/{fields.length}</span>
                  </div>

                  <div className="field-list-controls">
                    <label className="field-label">
                      <span>Find field</span>
                      <input
                        type="search"
                        value={fieldSearch}
                        onChange={(event) => setFieldSearch(event.target.value)}
                        placeholder="Name, type, required…"
                      />
                    </label>
                    <label className="field-label">
                      <span>Sort fields</span>
                      <select value={fieldSort} onChange={(event) => setFieldSort(event.target.value)}>
                        {FIELD_SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    {(fieldSearch || fieldSort !== 'name-asc') && (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => { setFieldSearch(''); setFieldSort('name-asc'); }}
                      >
                        Reset
                      </button>
                    )}
                  </div>

                  <div className="field-list">
                    {visibleFields.map((field) => (
                      <div className="field-row" key={field.field}>
                        <div className="field-row-main">
                          <strong>{field.field}</strong>
                          <span>{field.type}</span>
                        </div>
                        <div className="field-row-meta">
                          <span className={`status-pill ${field.required ? 'required' : ''}`}>{field.required ? 'Required' : 'Optional'}</span>
                          {field.field !== 'id' && !selectedCollection.system && (
                            <>
                              <button className="text-button" type="button" onClick={() => toggleRequired(field)}>
                                {field.required ? 'Make optional' : 'Make required'}
                              </button>
                              <button className="danger-button" type="button" onClick={() => deleteField(field)}>Delete</button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                    {fields.length > 0 && visibleFields.length === 0 && (
                      <div className="inline-info">No fields match this search.</div>
                    )}
                  </div>

                  {!selectedCollection.system && (
                    <form className="schema-create-card form-stack" onSubmit={createField}>
                      <div>
                        <strong>Add field</strong>
                        <p>Choose a field name and storage type. Type conversion is intentionally not available in V1.</p>
                      </div>
                      <div className="form-grid">
                        <label className="field-label">
                          <span>Field name</span>
                          <input
                            value={fieldForm.field}
                            onChange={(event) => setFieldForm((current) => ({ ...current, field: event.target.value }))}
                            placeholder="title"
                            required
                          />
                        </label>
                        <label className="field-label">
                          <span>Type</span>
                          <select value={fieldForm.type} onChange={(event) => setFieldForm((current) => ({ ...current, type: event.target.value }))}>
                            {FIELD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                          </select>
                        </label>
                        {fieldForm.type === 'string' && (
                          <label className="field-label">
                            <span>Max length</span>
                            <input
                              type="number"
                              min="1"
                              max="4096"
                              value={fieldForm.length}
                              onChange={(event) => setFieldForm((current) => ({ ...current, length: event.target.value }))}
                            />
                          </label>
                        )}
                        <label className="checkbox-label schema-checkbox">
                          <input
                            type="checkbox"
                            checked={fieldForm.required}
                            onChange={(event) => setFieldForm((current) => ({ ...current, required: event.target.checked }))}
                          />
                          Required value
                        </label>
                      </div>
                      <div className="form-actions"><button className="primary-button" type="submit">Add field</button></div>
                    </form>
                  )}
                </div>
              ) : (
                <div className="schema-tab-content">
                  {selectedCollection.system ? (
                    <div className="inline-info">System collection relations are visible through metadata but are not edited from this screen.</div>
                  ) : (
                    <div className="split-grid relation-builder-grid">
                      <article className="schema-create-card form-stack">
                        <div>
                          <p className="eyebrow">Many to one</p>
                          <h3>Link to one record</h3>
                          <p>Use an existing field in {selected} as the foreign-key field, then choose the target collection.</p>
                        </div>

                        <div className="list-stack relation-list">
                          {m2oRelations.length === 0 && <p className="muted-line">No direct relations for this collection.</p>}
                          {m2oRelations.map((relation) => (
                            <div className="relation-row" key={`${relation.many_collection}.${relation.many_field}`}>
                              <div>
                                <strong>{relation.many_collection}.{relation.many_field}</strong>
                                <small>links to {relation.one_collection}.{relation.one_field}</small>
                              </div>
                              <button className="danger-button" type="button" onClick={() => deleteM2O(relation)}>Delete</button>
                            </div>
                          ))}
                        </div>

                        <form className="form-stack compact" onSubmit={createM2O}>
                          <label className="field-label">
                            <span>Field in {selected}</span>
                            <select
                              value={m2oForm.manyField}
                              onChange={(event) => setM2oForm((current) => ({ ...current, manyField: event.target.value }))}
                              required
                            >
                              <option value="">Choose field</option>
                              {fields.filter((field) => field.field !== 'id').map((field) => (
                                <option key={field.field} value={field.field}>{field.field} ({field.type})</option>
                              ))}
                            </select>
                          </label>
                          <label className="field-label">
                            <span>Target collection</span>
                            <select
                              value={m2oForm.oneCollection}
                              onChange={(event) => setM2oForm((current) => ({ ...current, oneCollection: event.target.value }))}
                              required
                            >
                              <option value="">Choose collection</option>
                              {userCollections.map((entry) => <option key={entry.collection} value={entry.collection}>{entry.collection}</option>)}
                            </select>
                          </label>
                          <label className="field-label">
                            <span>If target is deleted</span>
                            <select value={m2oForm.onDelete} onChange={(event) => setM2oForm((current) => ({ ...current, onDelete: event.target.value }))}>
                              <option value="RESTRICT">Prevent deletion</option>
                              <option value="CASCADE">Delete linked records</option>
                              <option value="SET NULL">Clear this field</option>
                            </select>
                          </label>
                          <button className="primary-button" type="submit">Create relation</button>
                        </form>
                      </article>

                      <article className="schema-create-card form-stack">
                        <div>
                          <p className="eyebrow">Many to many</p>
                          <h3>Connect two collections</h3>
                          <p>YunCMS creates a hidden junction collection that stores both links.</p>
                        </div>

                        <div className="list-stack relation-list">
                          {m2mJunctions.length === 0 && <p className="muted-line">No many-to-many junctions for this collection.</p>}
                          {m2mJunctions.map((junction) => (
                            <div className="relation-row" key={junction.junctionCollection}>
                              <div>
                                <strong>{junction.junctionCollection}</strong>
                                <small>{junction.relations.map((relation) => relation.one_collection).join(' ↔ ')}</small>
                              </div>
                              <button className="danger-button" type="button" onClick={() => deleteM2M(junction.junctionCollection)}>Delete</button>
                            </div>
                          ))}
                        </div>

                        <form className="form-stack compact" onSubmit={createM2M}>
                          <label className="field-label">
                            <span>Junction name</span>
                            <input
                              value={m2mForm.junctionCollection}
                              onChange={(event) => setM2mForm((current) => ({ ...current, junctionCollection: event.target.value }))}
                              placeholder="article_tags"
                              required
                            />
                          </label>
                          <label className="field-label">
                            <span>First collection</span>
                            <select value={m2mForm.leftCollection} onChange={(event) => setM2mForm((current) => ({ ...current, leftCollection: event.target.value }))} required>
                              <option value="">Choose collection</option>
                              {userCollections.map((entry) => <option key={entry.collection} value={entry.collection}>{entry.collection}</option>)}
                            </select>
                          </label>
                          <label className="field-label">
                            <span>Second collection</span>
                            <select value={m2mForm.rightCollection} onChange={(event) => setM2mForm((current) => ({ ...current, rightCollection: event.target.value }))} required>
                              <option value="">Choose collection</option>
                              {userCollections.map((entry) => <option key={entry.collection} value={entry.collection}>{entry.collection}</option>)}
                            </select>
                          </label>
                          <button className="primary-button" type="submit">Create junction</button>
                        </form>
                      </article>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </section>

      {loading && <div className="muted-line">Loading schema…</div>}
    </div>
  );
}
