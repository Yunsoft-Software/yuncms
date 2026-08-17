import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import { isJunctionCollection } from '../collection-visibility.js';
import { Pagination, paginateClientItems } from '../components/Pagination.jsx';
import { useI18n } from '../i18n.js';

const PAGE_SIZES = [10, 20, 50];

function compareCollections(left, right) {
  const leftJunction = isJunctionCollection(left);
  const rightJunction = isJunctionCollection(right);
  if (leftJunction !== rightJunction) return leftJunction ? 1 : -1;
  return String(left.collection || '').localeCompare(String(right.collection || ''));
}

export function CollectionVisibilityScreen() {
  const { t } = useI18n();
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
      setError(requestError.message || t('visibility.loadError'));
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
      setNotice(t(shouldShow ? 'visibility.noticeVisible' : 'visibility.noticeHidden', {
        collection: collection.collection,
      }));
    } catch (requestError) {
      setError(requestError.message || t('visibility.updateError'));
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
            <p className="eyebrow">{t('nav.settings')}</p>
            <h2>{t('section.visibilityTitle')}</h2>
            <p>{t('visibility.description')}</p>
          </div>
          <div className="workspace-toolbar-actions">
            <span className="status-pill">{t('visibility.visibleCount', { count: visibleCount })}</span>
            <span className="status-pill">{t('visibility.hiddenCount', { count: hiddenCount })}</span>
            {junctionCount > 0 && <span className="status-pill">{t('visibility.junctionCount', { count: junctionCount })}</span>}
          </div>
        </div>

        <div className="list-controls compact-list-controls">
          <label className="field-label">
            <span>{t('visibility.searchCollections')}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('visibility.searchPlaceholder')}
            />
          </label>
          <label className="field-label">
            <span>{t('visibility.show')}</span>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
              <option value="all">{t('visibility.allCollections')}</option>
              <option value="visible">{t('visibility.visibleInContent')}</option>
              <option value="hidden">{t('visibility.hiddenFromContent')}</option>
              <option value="junction">{t('visibility.m2mJunctions')}</option>
            </select>
          </label>
        </div>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      {loading ? (
        <section className="panel"><p>{t('visibility.loading')}</p></section>
      ) : collections.length === 0 ? (
        <section className="panel empty-state">
          <div><h2>{t('visibility.emptyTitle')}</h2><p>{t('visibility.emptyDescription')}</p></div>
        </section>
      ) : visibleCollections.length === 0 ? (
        <section className="panel empty-state">
          <div><h2>{t('visibility.noMatchesTitle')}</h2><p>{t('visibility.noMatchesDescription')}</p></div>
        </section>
      ) : (
        <section className="table-panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>{t('visibility.collection')}</th><th>{t('common.type')}</th><th>{t('visibility.contentNavigation')}</th></tr>
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
                          {junction ? t('visibility.junction') : t('visibility.collection')}
                        </span>
                      </td>
                      <td>
                        <label className="permission-toggle">
                          <input
                            type="checkbox"
                            checked={shouldShow}
                            disabled={busy}
                            onChange={(event) => setContentVisibility(collection, event.target.checked)}
                            aria-label={t('visibility.showCollection', { collection: collection.collection })}
                          />
                          <span>{busy ? t('common.saving') : t(collection.hidden ? 'visibility.hiddenFromContent' : 'visibility.visibleInContent')}</span>
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
            itemLabel={t('visibility.collections')}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </section>
      )}

      <section className="panel inline-info">
        {t('visibility.hint')}
      </section>
    </div>
  );
}
