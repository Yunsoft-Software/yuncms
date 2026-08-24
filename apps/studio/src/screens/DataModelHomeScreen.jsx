import { useEffect, useMemo, useState } from 'react';

import {
  apiRequest,
  createNavigationGroup,
  deleteNavigationGroup,
  navigationGroups,
  updateNavigationGroup,
} from '../api.js';
import { collectionMetadataPatch, collectionUi } from '../collection-ui.js';
import { CollectionIcon } from '../components/CollectionIcon.jsx';
import { useConfirmDialog } from '../components/DialogProvider.jsx';
import { SidebarIcon } from '../components/SidebarIcon.jsx';
import { useI18n } from '../i18n.js';
import {
  buildNavigationModel,
  collectionDropPatches,
  groupDropPatches,
  sortNavigationGroups,
} from '../navigation-model.js';
import { displaySchemaName } from '../schema-name.js';
import { studioPath } from '../studio-route.js';

function DragDots() {
  return <span className="navigation-drag-dots" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>;
}

export function DataModelHomeScreen({ onNavigate, onCollectionsChanged }) {
  const { t } = useI18n();
  const confirmDialog = useConfirmDialog();
  const [collections, setCollections] = useState([]);
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [savingGroup, setSavingGroup] = useState(false);
  const [dragging, setDragging] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [collectionResponse, groupRows] = await Promise.all([
        apiRequest('/schema/collections'),
        navigationGroups(),
      ]);
      setCollections(collectionResponse?.data ?? []);
      setGroups(groupRows);
    } catch (requestError) {
      setError(requestError.message || t('navigation.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const model = useMemo(() => buildNavigationModel(collections, groups), [collections, groups]);
  const query = search.trim().toLowerCase();
  const filteredRoots = model.roots.filter((entry) => !query || [entry.name, entry.collection, entry.note]
    .filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
  const filteredGroups = model.groups
    .map((group) => ({
      ...group,
      collections: group.collections.filter((entry) => !query || [entry.name, entry.collection, entry.note]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(query))),
    }))
    .filter((group) => !query || group.name.toLowerCase().includes(query) || group.collections.length > 0);

  function flash(message) {
    setNotice(message);
    setError('');
  }

  async function refreshNavigation() {
    await load();
    await onCollectionsChanged?.();
  }

  async function patchCollection(collectionName, patch) {
    await apiRequest(`/schema/collections/${encodeURIComponent(collectionName)}`, {
      method: 'PATCH',
      body: patch,
    });
  }

  async function toggleVisibility(entry) {
    try {
      await patchCollection(entry.collection, { hidden: !Boolean(entry.hidden) });
      flash(entry.hidden ? t('navigation.collectionShown') : t('navigation.collectionHidden'));
      await refreshNavigation();
    } catch (requestError) {
      setError(requestError.message || t('navigation.updateFailed'));
    }
  }

  async function toggleSingleton(entry) {
    try {
      await patchCollection(entry.collection, { singleton: !Boolean(entry.singleton) });
      flash(entry.singleton ? t('navigation.singletonDisabled') : t('navigation.singletonEnabled'));
      await refreshNavigation();
    } catch (requestError) {
      setError(requestError.message || t('navigation.singletonFailed'));
    }
  }

  async function persistCollectionDrop(sourceName, target = {}) {
    const patches = collectionDropPatches(collections, sourceName, target);
    if (!patches.length) return;
    try {
      for (const patch of patches) {
        const entry = collections.find((item) => item.collection === patch.collection);
        if (!entry) continue;
        await patchCollection(patch.collection, {
          metadata: collectionMetadataPatch(entry, { group: patch.group, sort: patch.sort }),
        });
      }
      flash(t('navigation.orderSaved'));
      await refreshNavigation();
    } catch (requestError) {
      setError(requestError.message || t('navigation.orderFailed'));
    } finally {
      setDragging(null);
    }
  }

  async function persistGroupDrop(sourceId, targetId) {
    const patches = groupDropPatches(groups, sourceId, targetId);
    if (!patches.length) return;
    try {
      for (const patch of patches) await updateNavigationGroup(patch.id, { sort: patch.sort });
      flash(t('navigation.orderSaved'));
      await refreshNavigation();
    } catch (requestError) {
      setError(requestError.message || t('navigation.orderFailed'));
    } finally {
      setDragging(null);
    }
  }

  async function createGroup(event) {
    event.preventDefault();
    const name = groupName.trim();
    if (!name) return;
    setSavingGroup(true);
    try {
      const sorted = sortNavigationGroups(groups);
      const sort = sorted.length ? Number(sorted.at(-1)?.sort ?? 0) + 10 : 10;
      await createNavigationGroup({ name, sort });
      setGroupName('');
      setCreatingGroup(false);
      flash(t('navigation.groupCreated'));
      await refreshNavigation();
    } catch (requestError) {
      setError(requestError.message || t('navigation.groupCreateFailed'));
    } finally {
      setSavingGroup(false);
    }
  }

  async function removeGroup(group) {
    const accepted = await confirmDialog({
      title: t('navigation.deleteGroup'),
      description: t('navigation.deleteGroupDescription', { name: group.name }),
      confirmLabel: t('navigation.deleteGroupAction'),
      tone: 'danger',
    });
    if (!accepted) return;
    try {
      await deleteNavigationGroup(group.id);
      flash(t('navigation.groupDeleted'));
      await refreshNavigation();
    } catch (requestError) {
      setError(requestError.message || t('navigation.groupDeleteFailed'));
    }
  }

  function CollectionRow({ entry, grouped = false }) {
    const ui = collectionUi(entry);
    return (
      <div
        className={`navigation-collection-row ${entry.hidden ? 'is-hidden' : ''} ${grouped ? 'is-grouped' : ''}`}
        onDragOver={(event) => {
          if (dragging?.type !== 'collection') return;
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (dragging?.type === 'collection') persistCollectionDrop(dragging.id, { targetName: entry.collection });
        }}
      >
        <button
          className="navigation-row-main"
          type="button"
          onClick={() => onNavigate?.(studioPath.collection(entry.collection))}
        >
          <CollectionIcon name={ui.icon} size={18} />
          <span className="navigation-row-copy">
            <strong>{displaySchemaName(entry, 'collection')}</strong>
            <small>{entry.collection}{entry.note ? ` · ${entry.note}` : ''}</small>
          </span>
          {entry.singleton ? <span className="navigation-singleton-badge">{t('navigation.singleton')}</span> : null}
        </button>
        <div className="navigation-row-actions">
          <button
            className={`navigation-icon-button ${entry.singleton ? 'active' : ''}`}
            type="button"
            title={entry.singleton ? t('navigation.disableSingleton') : t('navigation.enableSingleton')}
            aria-label={entry.singleton ? t('navigation.disableSingleton') : t('navigation.enableSingleton')}
            onClick={() => toggleSingleton(entry)}
          >
            <span className="navigation-singleton-icon" aria-hidden="true">1</span>
          </button>
          <button
            className="navigation-icon-button"
            type="button"
            title={entry.hidden ? t('navigation.showCollection') : t('navigation.hideCollection')}
            aria-label={entry.hidden ? t('navigation.showCollection') : t('navigation.hideCollection')}
            onClick={() => toggleVisibility(entry)}
          >
            <SidebarIcon name="visibility" size={17} />
          </button>
          <button
            className="navigation-drag-handle"
            type="button"
            draggable
            title={t('navigation.dragCollection')}
            aria-label={t('navigation.dragCollection')}
            onDragStart={(event) => {
              setDragging({ type: 'collection', id: entry.collection });
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', entry.collection);
            }}
            onDragEnd={() => setDragging(null)}
          >
            <DragDots />
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="navigation-model-screen">
      <div className="navigation-model-toolbar">
        <div className="navigation-search-wrap">
          <input
            type="search"
            value={search}
            placeholder={t('navigation.search')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="navigation-toolbar-actions">
          <button className="secondary-button" type="button" onClick={() => setCreatingGroup((value) => !value)}>
            {t('navigation.createGroup')}
          </button>
          <button className="primary-button" type="button" onClick={() => onNavigate?.(studioPath.newCollection())}>
            {t('navigation.createCollection')}
          </button>
        </div>
      </div>

      {creatingGroup && (
        <form className="navigation-group-create" onSubmit={createGroup}>
          <input autoFocus value={groupName} maxLength="100" placeholder={t('navigation.groupName')} onChange={(event) => setGroupName(event.target.value)} />
          <button className="primary-button" type="submit" disabled={savingGroup || !groupName.trim()}>{t('navigation.addGroup')}</button>
          <button className="text-button" type="button" onClick={() => { setCreatingGroup(false); setGroupName(''); }}>{t('navigation.cancel')}</button>
        </form>
      )}

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}

      <div className="navigation-model-list panel">
        {loading ? <p className="muted-line">{t('navigation.loading')}</p> : (
          <>
            <div
              className="navigation-root-drop"
              onDragOver={(event) => {
                if (dragging?.type === 'collection') event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging?.type === 'collection') persistCollectionDrop(dragging.id, { groupId: null });
              }}
            >
              <span>{t('navigation.ungrouped')}</span>
            </div>

            {filteredRoots.map((entry) => <CollectionRow key={entry.collection} entry={entry} />)}

            {filteredGroups.map((group) => (
              <div
                key={group.id}
                className="navigation-group-block"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging?.type === 'collection') persistCollectionDrop(dragging.id, { groupId: group.id });
                  if (dragging?.type === 'group') persistGroupDrop(dragging.id, group.id);
                }}
              >
                <div className="navigation-group-row">
                  <span className="navigation-group-title">
                    <SidebarIcon name="content" size={17} />
                    <strong>{group.name}</strong>
                    <small>{t('navigation.menuOnlyGroup')}</small>
                  </span>
                  <span className="navigation-row-actions">
                    <button className="navigation-icon-button danger" type="button" title={t('navigation.deleteGroup')} onClick={() => removeGroup(group)}>×</button>
                    <button
                      className="navigation-drag-handle"
                      type="button"
                      draggable
                      title={t('navigation.dragGroup')}
                      aria-label={t('navigation.dragGroup')}
                      onDragStart={(event) => {
                        setDragging({ type: 'group', id: group.id });
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', group.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      <DragDots />
                    </button>
                  </span>
                </div>
                <div className="navigation-group-children">
                  {group.collections.map((entry) => <CollectionRow key={entry.collection} entry={entry} grouped />)}
                  {group.collections.length === 0 && <p className="navigation-empty-group">{t('navigation.emptyGroup')}</p>}
                </div>
              </div>
            ))}

            {filteredRoots.length === 0 && filteredGroups.length === 0 && (
              <p className="navigation-empty-state">{query ? t('navigation.noSearchResults') : t('navigation.noCollections')}</p>
            )}
          </>
        )}
      </div>

      <p className="navigation-model-hint">{t('navigation.hint')}</p>
    </section>
  );
}
