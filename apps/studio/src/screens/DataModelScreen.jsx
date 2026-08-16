import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';

const FIELD_TYPES = [
  'string', 'text', 'integer', 'bigint', 'decimal', 'boolean',
  'date', 'datetime', 'timestamp', 'json', 'uuid',
];

function parseJson(value) {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

export function DataModelScreen() {
  const [collections, setCollections] = useState([]);
  const [selected, setSelected] = useState('');
  const [fields, setFields] = useState([]);
  const [relations, setRelations] = useState([]);
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
        : rows.find((entry) => !entry.system)?.collection || '';
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
      setRelations((relationResponse?.data ?? []).filter((relation) =>
        relation.many_collection === collection || relation.one_collection === collection));
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
    loadSelected(selected);
  }, [selected]);

  const selectedCollection = collections.find((entry) => entry.collection === selected) ?? null;
  const userCollections = useMemo(() => collections.filter((entry) => !entry.system), [collections]);

  async function createCollection(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await apiRequest('/schema/collections', {
        method: 'POST',
        body: {
          collection: collectionForm.collection.trim(),
          note: collectionForm.note.trim() || null,
        },
      });
      const created = collectionForm.collection.trim();
      setCollectionForm({ collection: '', note: '' });
      setNotice(`Created collection ${created}`);
      await loadCollections(created);
    } catch (requestError) {
      setError(requestError.message || 'Collection could not be created');
    }
  }

  async function deleteCollection() {
    if (!selectedCollection || selectedCollection.system) return;
    if (!window.confirm(`Permanently delete collection ${selected}? This deletes its data.`)) return;
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
        method: 'POST',
        body,
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
    if (!window.confirm(`Permanently delete field ${selected}.${field.field}?`)) return;
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
    if (parseJson(relation.metadata)?.kind === 'm2m') return;
    if (!window.confirm(`Delete relation ${relation.many_collection}.${relation.many_field}?`)) return;
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
      await apiRequest('/schema/relations/m2m', {
        method: 'POST',
        body: {
          junctionCollection: m2mForm.junctionCollection.trim(),
          leftCollection: m2mForm.leftCollection,
          rightCollection: m2mForm.rightCollection,
        },
      });
      setNotice(`Created M2M junction ${m2mForm.junctionCollection.trim()}`);
      setM2mForm({ junctionCollection: '', leftCollection: '', rightCollection: '' });
      await loadCollections(selected);
      await loadSelected(selected);
    } catch (requestError) {
      setError(requestError.message || 'M2M relation could not be created');
    }
  }

  return (
    <div className="screen-stack">
      <section className="split-grid">
        <article className="panel form-panel">
          <div>
            <p className="eyebrow">Data Model</p>
            <h2>Collections</h2>
            <p>Create and inspect physical MySQL-backed collections.</p>
          </div>

          <div className="list-stack">
            {collections.map((entry) => (
              <button
                className={`list-button ${entry.collection === selected ? 'active' : ''}`}
                key={entry.collection}
                type="button"
                onClick={() => setSelected(entry.collection)}
              >
                <span>{entry.collection}</span>
                {entry.system && <small>system</small>}
              </button>
            ))}
          </div>

          <form className="form-stack compact" onSubmit={createCollection}>
            <label className="field-label">
              <span>Collection name</span>
              <input
                value={collectionForm.collection}
                onChange={(event) => setCollectionForm((current) => ({ ...current, collection: event.target.value }))}
                placeholder="articles"
                required
              />
            </label>
            <label className="field-label">
              <span>Note</span>
              <input
                value={collectionForm.note}
                onChange={(event) => setCollectionForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Optional description"
              />
            </label>
            <button className="primary-button" type="submit">Create collection</button>
          </form>
        </article>

        <article className="panel form-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Selected collection</p>
              <h2>{selected || 'None'}</h2>
              <p>{selectedCollection?.note || 'Select a collection to manage its fields.'}</p>
            </div>
            {selectedCollection && !selectedCollection.system && (
              <button className="danger-button" type="button" onClick={deleteCollection}>Delete collection</button>
            )}
          </div>

          {selected && (
            <>
              <div className="table-scroll compact-table">
                <table>
                  <thead><tr><th>Field</th><th>Type</th><th>Required</th><th /></tr></thead>
                  <tbody>
                    {fields.map((field) => (
                      <tr key={field.field}>
                        <td>{field.field}</td>
                        <td>{field.type}</td>
                        <td>{field.required ? 'Yes' : 'No'}</td>
                        <td className="row-actions">
                          {field.field !== 'id' && !selectedCollection?.system && (
                            <>
                              <button className="text-button" type="button" onClick={() => toggleRequired(field)}>
                                {field.required ? 'Make optional' : 'Make required'}
                              </button>
                              <button className="danger-button" type="button" onClick={() => deleteField(field)}>Delete</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!selectedCollection?.system && (
                <form className="form-grid inline-form" onSubmit={createField}>
                  <label className="field-label">
                    <span>Field</span>
                    <input
                      value={fieldForm.field}
                      onChange={(event) => setFieldForm((current) => ({ ...current, field: event.target.value }))}
                      placeholder="title"
                      required
                    />
                  </label>
                  <label className="field-label">
                    <span>Type</span>
                    <select
                      value={fieldForm.type}
                      onChange={(event) => setFieldForm((current) => ({ ...current, type: event.target.value }))}
                    >
                      {FIELD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  {fieldForm.type === 'string' && (
                    <label className="field-label">
                      <span>Length</span>
                      <input
                        type="number"
                        min="1"
                        max="4096"
                        value={fieldForm.length}
                        onChange={(event) => setFieldForm((current) => ({ ...current, length: event.target.value }))}
                      />
                    </label>
                  )}
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={fieldForm.required}
                      onChange={(event) => setFieldForm((current) => ({ ...current, required: event.target.checked }))}
                    />
                    Required
                  </label>
                  <button className="primary-button" type="submit">Add field</button>
                </form>
              )}
            </>
          )}
        </article>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}
      {loading && <div className="muted-line">Loading schema…</div>}

      {selected && !selectedCollection?.system && (
        <section className="split-grid">
          <article className="panel form-panel">
            <div>
              <p className="eyebrow">Relations</p>
              <h2>M2O / O2M</h2>
              <p>Foreign keys are created on existing fields; O2M is the inverse metadata view.</p>
            </div>

            <div className="list-stack">
              {relations.length === 0 && <p className="muted-line">No relations for this collection.</p>}
              {relations.map((relation) => {
                const metadata = parseJson(relation.metadata);
                return (
                  <div className="relation-row" key={`${relation.many_collection}.${relation.many_field}`}>
                    <div>
                      <strong>{relation.many_collection}.{relation.many_field}</strong>
                      <small> → {relation.one_collection}.{relation.one_field} · {metadata?.kind || 'm2o'}</small>
                    </div>
                    {metadata?.kind !== 'm2m' && (
                      <button className="danger-button" type="button" onClick={() => deleteM2O(relation)}>Delete</button>
                    )}
                  </div>
                );
              })}
            </div>

            <form className="form-stack compact" onSubmit={createM2O}>
              <label className="field-label">
                <span>Many-side field</span>
                <select
                  value={m2oForm.manyField}
                  onChange={(event) => setM2oForm((current) => ({ ...current, manyField: event.target.value }))}
                  required
                >
                  <option value="">Select field</option>
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
                  <option value="">Select collection</option>
                  {userCollections.map((entry) => (
                    <option key={entry.collection} value={entry.collection}>{entry.collection}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                <span>On delete</span>
                <select
                  value={m2oForm.onDelete}
                  onChange={(event) => setM2oForm((current) => ({ ...current, onDelete: event.target.value }))}
                >
                  <option value="RESTRICT">RESTRICT</option>
                  <option value="CASCADE">CASCADE</option>
                  <option value="SET NULL">SET NULL</option>
                </select>
              </label>
              <button className="primary-button" type="submit">Create M2O</button>
            </form>
          </article>

          <article className="panel form-panel">
            <div>
              <p className="eyebrow">Relations</p>
              <h2>M2M junction</h2>
              <p>Create a hidden junction collection with two required foreign keys and a unique pair.</p>
            </div>

            <form className="form-stack compact" onSubmit={createM2M}>
              <label className="field-label">
                <span>Junction collection</span>
                <input
                  value={m2mForm.junctionCollection}
                  onChange={(event) => setM2mForm((current) => ({ ...current, junctionCollection: event.target.value }))}
                  placeholder="article_tags"
                  required
                />
              </label>
              <label className="field-label">
                <span>Left collection</span>
                <select
                  value={m2mForm.leftCollection}
                  onChange={(event) => setM2mForm((current) => ({ ...current, leftCollection: event.target.value }))}
                  required
                >
                  <option value="">Select collection</option>
                  {userCollections.map((entry) => <option key={entry.collection} value={entry.collection}>{entry.collection}</option>)}
                </select>
              </label>
              <label className="field-label">
                <span>Right collection</span>
                <select
                  value={m2mForm.rightCollection}
                  onChange={(event) => setM2mForm((current) => ({ ...current, rightCollection: event.target.value }))}
                  required
                >
                  <option value="">Select collection</option>
                  {userCollections.map((entry) => <option key={entry.collection} value={entry.collection}>{entry.collection}</option>)}
                </select>
              </label>
              <button className="primary-button" type="submit">Create M2M</button>
            </form>
          </article>
        </section>
      )}
    </div>
  );
}
