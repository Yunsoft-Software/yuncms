import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';

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

function RecordForm({ collection, fields, record, onSaved, onCancel }) {
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
    <form className="panel form-panel" onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{record?.id ? 'Edit record' : 'New record'}</p>
          <h2>{collection}</h2>
        </div>
        <button className="text-button" type="button" onClick={onCancel}>Cancel</button>
      </div>

      <div className="form-grid">
        {editable.map((field) => (
          <label className="field-label" key={field.field}>
            <span>{field.field}{field.required ? ' *' : ''}</span>
            {field.type === 'boolean' ? (
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
                type={
                  ['integer', 'bigint', 'decimal'].includes(field.type) ? 'number'
                    : field.type === 'date' ? 'date'
                      : ['datetime', 'timestamp'].includes(field.type) ? 'datetime-local'
                        : 'text'
                }
                step={field.type === 'decimal' ? 'any' : undefined}
                value={values[field.field] ?? ''}
                onChange={(event) => setValues((current) => ({
                  ...current,
                  [field.field]: event.target.value,
                }))}
                required={Boolean(field.required)}
              />
            )}
          </label>
        ))}
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

export function ContentScreen() {
  const [collections, setCollections] = useState([]);
  const [collection, setCollection] = useState('');
  const [fields, setFields] = useState([]);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadCollections() {
    setLoading(true);
    setError('');
    try {
      const response = await apiRequest('/schema/collections');
      const visible = (response?.data ?? []).filter((entry) => !entry.system && !entry.hidden);
      setCollections(visible);
      setCollection((current) => current || visible[0]?.collection || '');
    } catch (requestError) {
      setError(requestError.message || 'Collections could not be loaded');
    } finally {
      setLoading(false);
    }
  }

  async function loadCollectionData(target = collection) {
    if (!target) {
      setFields([]);
      setItems([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [fieldResponse, itemResponse] = await Promise.all([
        apiRequest(`/schema/collections/${encodeURIComponent(target)}/fields`),
        apiRequest(`/items/${encodeURIComponent(target)}?limit=50`),
      ]);
      setFields(fieldResponse?.data ?? []);
      setItems(itemResponse?.data ?? []);
      setMeta(itemResponse?.meta ?? null);
    } catch (requestError) {
      setError(requestError.message || 'Collection data could not be loaded');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCollections();
  }, []);

  useEffect(() => {
    setEditing(null);
    setCreating(false);
    loadCollectionData(collection);
  }, [collection]);

  async function removeRecord(record) {
    if (!record?.id || !window.confirm(`Delete record ${record.id}?`)) return;
    setError('');
    try {
      await apiRequest(
        `/items/${encodeURIComponent(collection)}/${encodeURIComponent(record.id)}`,
        { method: 'DELETE' },
      );
      await loadCollectionData();
    } catch (requestError) {
      setError(requestError.message || 'Record could not be deleted');
    }
  }

  const tableFields = fields.filter((field) => !field.hidden).slice(0, 8);

  if (creating || editing) {
    return (
      <RecordForm
        collection={collection}
        fields={fields}
        record={editing}
        onCancel={() => { setCreating(false); setEditing(null); }}
        onSaved={async () => {
          setCreating(false);
          setEditing(null);
          await loadCollectionData();
        }}
      />
    );
  }

  return (
    <div className="screen-stack">
      <section className="panel toolbar-panel">
        <div>
          <p className="eyebrow">Content</p>
          <h2>Records</h2>
          <p>Generic CRUD is generated from YunCMS schema metadata.</p>
        </div>
        <div className="toolbar-actions">
          <select
            aria-label="Collection"
            value={collection}
            onChange={(event) => setCollection(event.target.value)}
          >
            {collections.map((entry) => (
              <option key={entry.collection} value={entry.collection}>{entry.collection}</option>
            ))}
          </select>
          <button
            className="primary-button"
            type="button"
            disabled={!collection}
            onClick={() => setCreating(true)}
          >
            New record
          </button>
        </div>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {loading ? (
        <section className="panel"><p>Loading…</p></section>
      ) : !collection ? (
        <section className="panel empty-state">
          <div><h2>No collections</h2><p>Create a collection from Data Model first.</p></div>
        </section>
      ) : items.length === 0 ? (
        <section className="panel empty-state">
          <div><h2>No records</h2><p>This collection is ready for its first record.</p></div>
          <button className="primary-button" type="button" onClick={() => setCreating(true)}>Create record</button>
        </section>
      ) : (
        <section className="table-panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {tableFields.map((field) => <th key={field.field}>{field.field}</th>)}
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {items.map((record) => (
                  <tr key={record.id}>
                    {tableFields.map((field) => (
                      <td key={field.field}>{
                        record[field.field] == null ? '—'
                          : typeof record[field.field] === 'object'
                            ? JSON.stringify(record[field.field])
                            : String(record[field.field])
                      }</td>
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
          <div className="table-footer">Showing {items.length}{meta?.total_count != null ? ` of ${meta.total_count}` : ''} records</div>
        </section>
      )}
    </div>
  );
}
