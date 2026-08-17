import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import {
  collectionVisibilityLabel,
  isJunctionCollection,
} from '../collection-visibility.js';
import { Pagination, paginateClientItems } from '../components/Pagination.jsx';

const PAGE_SIZES = [10, 20, 50];

function compareCollections(left, right) {
  const leftJunction = isJunctionCollection(left);
  const rightJunction = isJunctionCollection(right);
  if (leftJunction !== rightJunction) return leftJunction ? 1 : -1;
  return String(left.collection || '').localeCompare(String(right.collection || ''));
}

export function CollectionVisibilityScreen() {
  const [collections, setCollections] = useState([]);
  const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [busyCollection, setBusyCollection] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await apiRequest('/schema/collections');
      setCollections((response?.data ?? []).filter((entry) => !entry.system));
    } catch (requestError) {
      setError(requestError.message || 'Collection visibility settings could not be loaded');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const visibleCollections = useMemo(() => {
    const query = search.trim().toLowerCase();
    return collections
      .filter((entry) => {
        if (visibility === 'visible') return !entry.hidden;
        if (visibility === 'hidden') return Boolean(entry.hidden);
        if (visibility === 'junction') return isJunctionCollection(entry);
        return true;
      })
      .filter((entry) => !query || [entry.collection, entry.note]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)))
      .slice()
      .sort(compareCollections);
  }, [collections, search, visibility]);

  const paged = useMemo(
    () => paginateClientItems(visibleCollections, page, pageSize),
    [page, pageSize, visibleCollections],
  );

  useEffect(() => {
    setPage(1);
  }, [search, visibility]);

  async function setContentVisibility(collection, shouldShow) {
    setBusyCollection(collection.collection);
    setError('');
    setNotice('');
    try {
      const response = await apiRequest(`/schema/collections/${encodeURIComponent(collection.collection)}`, {
        method: 'PATCH',
        body: { hidden: !shouldShow },
      });
      const updated = response?.data;
      setCollections((current) => current.map((entry) => (
        entry.collection === collection.collection ? { ...entry, ...updated } : entry
      )));
      setNotice(`${collection.collection} is now ${shouldShow ? 'visible in' : 'hidden from'} Content`);
    } catch (requestError) {
      setError(requestError.message || 'Collection visibility could not be updated');
    } finally {
      setBusyCollection('');
    }
  }

  const visibleCount = collections.filter((entry) => !entry.hidden).length;
  const hiddenCount = collections.length - visibleCount;
  const junctionCount = collections.filter(isJunctionCollection).length;

  return (
    <div className="screen-stack">
      <section className="panel workspace-toolbar">
        <div className="workspace-toolbar-heading">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Content visibility</h2>
            <p>Choose which collections appear in the Content navigation. Hiding a collection never deletes its schema or records.</p>
          </div>
          <div className="workspace-toolbar-actions">
            <span className="status-pill">{visibleCount} visible</span>
            <span className="status-pill">{hiddenCount} hidden</span>
            {junctionCount > 0 && <span className="status-pill">{junctionCount} junctions</span>}
          </div>
        </div>

        <div className="list-controls compact-list-controls">
          <label className="field-label">
            <span>Search collections</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or description…"
            />
          </label>
          <label className="field-label">
            <span>Show</span>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
              <option value="all">All collections</option>
              <option value="visible">Visible in Content</option>
              <option value="hidden">Hidden from Content</option>
              <option value="junction">M2M junctions</option>
            </select>
          </label>
        </div>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      {loading ? (
        <section className="panel"><p>Loading collection settings…</p></section>
      ) : collections.length === 0 ? (
        <section className="panel empty-state">
          <div><h2>No project collections</h2><p>Create a collection in Data Model first.</p></div>
        </section>
      ) : visibleCollections.length === 0 ? (
        <section className="panel empty-state">
          <div><h2>No matching collections</h2><p>Change the search or visibility filter.</p></div>
        </section>
      ) : (
        <section className="table-panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Collection</th><th>Type</th><th>Content navigation</th></tr>
              </thead>
              <tbody>
                {paged.items.map((collection) => {
                  const junction = isJunctionCollection(collection);
                  const shouldShow = !Boolean(collection.hidden);
                  const busy = busyCollection === collection.collection;
                  return (
                    <tr key={collection.collection}>
                      <td>
                        <strong>{collection.collection}</strong>
                        {collection.note && <><br /><small>{collection.note}</small></>}
                      </td>
                      <td>
                        <span className={`status-pill ${junction ? 'required' : ''}`}>
                          {junction ? 'M2M junction' : 'Collection'}
                        </span>
                      </td>
                      <td>
                        <label className="permission-toggle">
                          <input
                            type="checkbox"
                            checked={shouldShow}
                            disabled={busy}
                            onChange={(event) => setContentVisibility(collection, event.target.checked)}
                            aria-label={`Show ${collection.collection} in Content`}
                          />
                          <span>{busy ? 'Saving…' : collectionVisibilityLabel(collection)}</span>
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={paged.page}
            pageSize={pageSize}
            totalItems={visibleCollections.length}
            pageSizeOptions={PAGE_SIZES}
            itemLabel="collections"
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </section>
      )}

      <section className="panel inline-info">
        M2M junction collections are hidden by default because they usually store relation links rather than primary content. You can still make any junction visible here when direct record management is useful.
      </section>
    </div>
  );
}
