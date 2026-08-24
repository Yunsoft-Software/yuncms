import { useEffect, useMemo, useRef, useState } from 'react';

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
  navigationAppendPatches,
  navigationDropPatches,
  navigationPointerPosition,
} from '../navigation-model.js';
import { displaySchemaName } from '../schema-name.js';
import { studioPath } from '../studio-route.js';

function DragDots() {
  return <span className="navigation-drag-dots" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>;
}

function collectionMatches(entry, query) {
  return !query || [entry.name, entry.collection, entry.note]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
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
  const [groupEditor, setGroupEditor] = useState(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const draggingRef = useRef(null);

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

  useEffect(() => {
    setExpandedGroups((current) => Object.fromEntries(groups.map((group) => [
      group.id,
      group.collapse === 'locked'
        ? true
        : Object.hasOwn(current, group.id) ? current[group.id] : group.collapse !== 'closed',
    ])));
  }, [groups]);

  const model = useMemo(() => buildNavigationModel(collections, groups), [collections, groups]);
  const query = search.trim().toLowerCase();
  const visibleNodes = useMemo(() => model.nodes.flatMap((node) => {
    if (node.type === 'collection') return collectionMatches(node.entry, query) ? [node] : [];
    if (!query || node.group.name.toLowerCase().includes(query)) return [node];
    const matches = node.group.collections.filter((entry) => collectionMatches(entry, query));
    return matches.length ? [{ ...node, group: { ...node.group, collections: matches } }] : [];
  }), [model, query]);
  const collectionCount = model.roots.length
    + model.groups.reduce((total, group) => total + group.collections.length, 0);

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

  async function persistDrop(target = {}, source = draggingRef.current ?? dragging) {
    if (!source || query) return;
    const patches = navigationDropPatches(collections, groups, source, target);
    setDropTarget(null);
    if (!patches.collections.length && !patches.groups.length) {
      draggingRef.current = null;
      setDragging(null);
      return;
    }
    try {
      for (const patch of patches.groups) {
        await updateNavigationGroup(patch.id, { sort: patch.sort });
      }
      for (const patch of patches.collections) {
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
      draggingRef.current = null;
      setDragging(null);
      setDropTarget(null);
    }
  }

  function pointerTargetAt(clientX, clientY, source) {
    const element = document.elementFromPoint(clientX, clientY);
    const targetElement = element?.closest?.('[data-navigation-drop-type]');
    if (!targetElement) return null;
    const type = targetElement.dataset.navigationDropType;
    const id = targetElement.dataset.navigationDropId;
    if (type === 'root') return { type: 'root', id: id || 'end', position: 'after' };
    if (!['collection', 'group'].includes(type) || !id) return null;
    if (source.type === 'group' && targetElement.dataset.navigationGrouped === 'true') return null;
    const forcedPosition = targetElement.dataset.navigationDropPosition;
    if (forcedPosition === 'inside') {
      return source.type === 'collection' ? { type, id, position: 'inside' } : null;
    }
    const bounds = targetElement.getBoundingClientRect();
    return {
      type,
      id,
      position: navigationPointerPosition({
        top: bounds.top,
        height: bounds.height,
        clientY,
        allowInside: type === 'group' && source.type === 'collection',
      }),
    };
  }

  function startPointerDrag(event, source) {
    if (query || (event.pointerType !== 'touch' && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = source;
    setDragging(source);
    setDropTarget(null);
  }

  function movePointerDrag(event) {
    const source = draggingRef.current;
    if (!source) return;
    event.preventDefault();
    setDropTarget(pointerTargetAt(event.clientX, event.clientY, source));
  }

  function finishPointerDrag(event) {
    const source = draggingRef.current;
    if (!source) return;
    if (event.cancelable) event.preventDefault();
    const target = pointerTargetAt(event.clientX, event.clientY, source);
    draggingRef.current = null;
    if (!target) {
      setDragging(null);
      setDropTarget(null);
      return;
    }
    persistDrop(target, source);
  }

  function cancelPointerDrag() {
    draggingRef.current = null;
    setDragging(null);
    setDropTarget(null);
  }

  useEffect(() => {
    if (!dragging) return undefined;
    const move = (event) => movePointerDrag(event);
    const finish = (event) => finishPointerDrag(event);
    const cancel = () => cancelPointerDrag();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('mousemove', move, { passive: false });
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('mouseup', finish, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('mouseup', finish, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', cancel);
    };
  }, [dragging]);

  function dragClass(type, id) {
    if (dropTarget?.type !== type || dropTarget?.id !== id) return '';
    return `is-drop-${dropTarget.position}`;
  }

  function openCreateGroup() {
    setGroupEditor({ mode: 'create', name: '', collapse: 'open' });
    setError('');
  }

  function openEditGroup(group) {
    setGroupEditor({ mode: 'edit', id: group.id, name: group.name, collapse: group.collapse });
    setError('');
  }

  async function saveGroup(event) {
    event.preventDefault();
    const name = groupEditor?.name.trim();
    if (!name) return;
    setSavingGroup(true);
    try {
      if (groupEditor.mode === 'create') {
        const placement = navigationAppendPatches(collections, groups);
        for (const patch of placement.groups) {
          await updateNavigationGroup(patch.id, { sort: patch.sort });
        }
        for (const patch of placement.collections) {
          const entry = collections.find((item) => item.collection === patch.collection);
          if (!entry) continue;
          await patchCollection(patch.collection, {
            metadata: collectionMetadataPatch(entry, { group: patch.group, sort: patch.sort }),
          });
        }
        const created = await createNavigationGroup({
          name,
          collapse: groupEditor.collapse,
          sort: placement.sort,
        });
        setExpandedGroups((current) => ({
          ...current,
          [created.id]: groupEditor.collapse !== 'closed',
        }));
        flash(t('navigation.groupCreated'));
      } else {
        await updateNavigationGroup(groupEditor.id, { name, collapse: groupEditor.collapse });
        setExpandedGroups((current) => ({
          ...current,
          [groupEditor.id]: groupEditor.collapse !== 'closed',
        }));
        flash(t('navigation.groupRenamed'));
      }
      setGroupEditor(null);
      await refreshNavigation();
    } catch (requestError) {
      setError(requestError.message || t(groupEditor?.mode === 'edit'
        ? 'navigation.groupRenameFailed'
        : 'navigation.groupCreateFailed'));
    } finally {
      setSavingGroup(false);
    }
  }

  async function removeGroup(group) {
    if (!group) return;
    const accepted = await confirmDialog({
      title: t('navigation.deleteGroup'),
      description: t('navigation.deleteGroupDescription', { name: group.name }),
      confirmLabel: t('navigation.deleteGroupAction'),
      tone: 'danger',
    });
    if (!accepted) return;
    try {
      await deleteNavigationGroup(group.id);
      setGroupEditor(null);
      flash(t('navigation.groupDeleted'));
      await refreshNavigation();
    } catch (requestError) {
      setError(requestError.message || t('navigation.groupDeleteFailed'));
    }
  }

  function toggleGroup(group) {
    if (query || group.collapse === 'locked') return;
    setExpandedGroups((current) => ({ ...current, [group.id]: !current[group.id] }));
  }

  function CollectionRow({ entry, grouped = false }) {
    const ui = collectionUi(entry);
    const isDragging = dragging?.type === 'collection' && dragging.id === entry.collection;
    return (
      <div
        className={`navigation-collection-row ${entry.hidden ? 'is-hidden' : ''} ${grouped ? 'is-grouped' : ''} ${isDragging ? 'is-dragging' : ''} ${dragClass('collection', entry.collection)}`}
        data-navigation-drop-type="collection"
        data-navigation-drop-id={entry.collection}
        data-navigation-grouped={grouped ? 'true' : 'false'}
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
            <SidebarIcon name={entry.hidden ? 'visibility-off' : 'visibility'} size={17} />
          </button>
          {!query && (
            <button
              className="navigation-drag-handle"
              type="button"
              title={t('navigation.dragCollection')}
              aria-label={t('navigation.dragCollection')}
              onPointerDown={(event) => startPointerDrag(event, { type: 'collection', id: entry.collection })}
              onPointerMove={movePointerDrag}
              onPointerUp={finishPointerDrag}
              onPointerCancel={cancelPointerDrag}
            >
              <DragDots />
            </button>
          )}
        </div>
      </div>
    );
  }

  function GroupNode({ group }) {
    const expanded = query || group.collapse === 'locked' || Boolean(expandedGroups[group.id]);
    const isDragging = dragging?.type === 'group' && dragging.id === group.id;
    return (
      <div className="navigation-group-node">
        <div
          className={`navigation-group-row ${isDragging ? 'is-dragging' : ''} ${dragClass('group', group.id)}`}
          data-navigation-drop-type="group"
          data-navigation-drop-id={group.id}
        >
          <button
            className="navigation-group-main"
            type="button"
            aria-expanded={expanded}
            onClick={() => toggleGroup(group)}
          >
            <span className={`navigation-group-chevron ${expanded ? 'open' : ''}`}>
              <SidebarIcon name="chevron" size={14} />
            </span>
            <CollectionIcon name="folder" size={19} />
            <span className="navigation-row-copy">
              <strong>{group.name}</strong>
              <small>{t('navigation.groupSummary', {
                count: group.collections.length,
                behavior: t(`navigation.collapse.${group.collapse}`),
              })}</small>
            </span>
          </button>
          <div className="navigation-row-actions">
            <button className="navigation-edit-group text-button" type="button" onClick={() => openEditGroup(group)}>
              {t('navigation.editGroup')}
            </button>
            {!query && (
              <button
                className="navigation-drag-handle"
                type="button"
                title={t('navigation.dragGroup')}
                aria-label={t('navigation.dragGroup')}
                onPointerDown={(event) => startPointerDrag(event, { type: 'group', id: group.id })}
                onPointerMove={movePointerDrag}
                onPointerUp={finishPointerDrag}
                onPointerCancel={cancelPointerDrag}
              >
                <DragDots />
              </button>
            )}
          </div>
        </div>
        {expanded && (
          <div
            className="navigation-group-children"
            data-navigation-drop-type="group"
            data-navigation-drop-id={group.id}
            data-navigation-drop-position="inside"
          >
            {group.collections.map((entry) => <CollectionRow key={entry.collection} entry={entry} grouped />)}
            {group.collections.length === 0 && <p className="navigation-empty-group">{t('navigation.emptyGroup')}</p>}
          </div>
        )}
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
          <button className="secondary-button" type="button" onClick={openCreateGroup}>
            <CollectionIcon name="folder" size={16} />
            {t('navigation.createGroup')}
          </button>
          <button className="primary-button" type="button" onClick={() => onNavigate?.(studioPath.newCollection())}>
            {t('navigation.createCollection')}
          </button>
        </div>
      </div>

      {groupEditor && (
        <form className="navigation-group-editor" onSubmit={saveGroup}>
          <div className="navigation-group-editor-heading">
            <strong>{t(groupEditor.mode === 'create' ? 'navigation.createGroupTitle' : 'navigation.editGroupTitle')}</strong>
            <small>{t('navigation.groupEditorHint')}</small>
          </div>
          <label>
            <span>{t('navigation.groupName')}</span>
            <input
              autoFocus
              value={groupEditor.name}
              maxLength="100"
              onChange={(event) => setGroupEditor((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label>
            <span>{t('navigation.collapseLabel')}</span>
            <select
              value={groupEditor.collapse}
              onChange={(event) => setGroupEditor((current) => ({ ...current, collapse: event.target.value }))}
            >
              <option value="open">{t('navigation.collapse.open')}</option>
              <option value="closed">{t('navigation.collapse.closed')}</option>
              <option value="locked">{t('navigation.collapse.locked')}</option>
            </select>
          </label>
          <div className="navigation-group-editor-actions">
            {groupEditor.mode === 'edit' && (
              <button
                className="text-button danger"
                type="button"
                onClick={() => removeGroup(groups.find((group) => group.id === groupEditor.id))}
              >
                {t('navigation.deleteGroupAction')}
              </button>
            )}
            <span />
            <button className="text-button" type="button" onClick={() => setGroupEditor(null)}>{t('navigation.cancel')}</button>
            <button className="primary-button" type="submit" disabled={savingGroup || !groupEditor.name.trim()}>
              {t(groupEditor.mode === 'create' ? 'navigation.addGroup' : 'navigation.saveGroupName')}
            </button>
          </div>
        </form>
      )}

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}

      <div className="navigation-model-list panel">
        <div className="navigation-list-heading">
          <span>
            <strong>{t('navigation.structureTitle')}</strong>
            <small>{t('navigation.structureSummary', { collections: collectionCount, groups: model.groups.length })}</small>
          </span>
          <small>{t(query ? 'navigation.dragDisabledSearch' : 'navigation.dragReady')}</small>
        </div>
        {loading ? <p className="muted-line">{t('navigation.loading')}</p> : (
          <div className="navigation-tree">
            {visibleNodes.map((node) => node.type === 'group'
              ? <GroupNode key={`group:${node.id}`} group={node.group} />
              : <CollectionRow key={`collection:${node.id}`} entry={node.entry} />)}

            {dragging && !query && (
              <div
                className={`navigation-root-drop ${dropTarget?.type === 'root' ? 'active' : ''}`}
                data-navigation-drop-type="root"
                data-navigation-drop-id="end"
              >
                {t('navigation.moveToRootEnd')}
              </div>
            )}

            {visibleNodes.length === 0 && (
              <p className="navigation-empty-state">{query ? t('navigation.noSearchResults') : t('navigation.noCollections')}</p>
            )}
          </div>
        )}
      </div>

      <p className="navigation-model-hint">{t('navigation.hint')}</p>
    </section>
  );
}
