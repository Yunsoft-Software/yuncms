import { useEffect, useLayoutEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import { useI18n } from '../i18n.js';
import { displaySchemaName } from '../schema-name.js';
import { navigateStudio, readStudioRoute, studioPath } from '../studio-route.js';
import { CommandPalette } from './CommandPalette.jsx';
import { SidebarIcon } from './SidebarIcon.jsx';
import { StudioBrand } from './StudioBrand.jsx';

function currentDestination(id, route) {
  if (id === 'access') return route.section === 'users' || route.section === 'roles';
  if (id === 'settings') return route.section === 'appearance' || route.section === 'mcp';
  return route.section === id;
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function commandForCurrentRoute(route, t) {
  if (route.section === 'content' && route.collection) {
    return {
      id: 'new-record',
      icon: 'content',
      label: t('content.newRecord'),
      path: () => studioPath.contentNew(route.collection),
    };
  }
  if (route.section === 'files') {
    return { id: 'upload-file', icon: 'files', label: t('files.uploadFile'), path: studioPath.newFile };
  }
  if (route.section === 'data-model') {
    return { id: 'new-collection', icon: 'model', label: t('dataModel.createCollection'), path: studioPath.newCollection };
  }
  if (route.section === 'roles') {
    return { id: 'new-role', icon: 'roles', label: t('roles.createRole'), path: studioPath.newRole };
  }
  if (route.section === 'users') {
    return { id: 'new-user', icon: 'users', label: t('users.newUser'), path: studioPath.newUser };
  }
  return null;
}

function collectionCommands(collections, t) {
  return collections
    .filter((collection) => !collection.system && !collection.hidden)
    .map((collection) => ({
      id: `collection-${collection.collection}`,
      icon: 'content',
      label: `${t('nav.content')}: ${displaySchemaName(collection, 'collection')} · ${collection.collection}`,
      path: () => studioPath.content(collection.collection),
    }));
}

export function AppRail() {
  const { t } = useI18n();
  const [route, setRoute] = useState(() => readStudioRoute());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collections, setCollections] = useState([]);

  useEffect(() => {
    const update = () => {
      setRoute(readStudioRoute());
      setPaletteOpen(false);
    };
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
    };
  }, []);

  useEffect(() => {
    if (!paletteOpen || document.querySelector('.auth-layout')) return undefined;
    let cancelled = false;
    apiRequest('/schema/collections')
      .then((response) => { if (!cancelled) setCollections(response?.data ?? []); })
      .catch(() => { if (!cancelled) setCollections([]); });
    return () => { cancelled = true; };
  }, [paletteOpen]);

  useEffect(() => {
    function handleShortcut(event) {
      if (document.querySelector('.auth-layout')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }
      if (
        event.key === '/'
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && !isEditableTarget(event.target)
      ) {
        const search = [...document.querySelectorAll('.studio-next-app input[type="search"]:not(:disabled)')]
          .find((input) => input.getClientRects().length > 0);
        if (!search) return;
        event.preventDefault();
        search.focus();
        search.select?.();
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const destinations = useMemo(() => [
    {
      id: 'content',
      icon: 'content',
      label: t('nav.content'),
      path: () => studioPath.content(route.section === 'content' ? route.collection : ''),
    },
    { id: 'files', icon: 'files', label: t('nav.files'), path: studioPath.files },
    { id: 'data-model', icon: 'model', label: t('nav.dataModel'), path: studioPath.dataModel },
    { id: 'ai', icon: 'ai', label: t('nav.ai'), path: studioPath.ai },
    { id: 'access', icon: 'roles', label: t('roles.access'), path: studioPath.roles },
    { id: 'settings', icon: 'appearance', label: t('nav.settings'), path: studioPath.appearance },
  ], [route.collection, route.section, t]);

  const commands = useMemo(() => {
    const contextual = commandForCurrentRoute(route, t);
    return [
      ...(contextual ? [{ ...contextual, id: `action-${contextual.id}` }] : []),
      ...destinations.map((destination) => ({ ...destination, id: `nav-${destination.id}` })),
      ...collectionCommands(collections, t),
    ];
  }, [collections, destinations, route, t]);

  return (
    <>
      <aside className="studio-app-rail" aria-label={t('nav.studioSections')}>
        <div className="studio-app-rail-brand">
          <StudioBrand compact />
        </div>

        <nav className="studio-app-rail-nav">
          {destinations.map((item) => {
            const active = currentDestination(item.id, route);
            return (
              <button
                key={item.id}
                className={`studio-app-rail-button ${active ? 'active' : ''}`}
                type="button"
                aria-current={active ? 'page' : undefined}
                title={item.label}
                onClick={() => navigateStudio(item.path())}
              >
                <SidebarIcon name={item.icon} size={19} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <button
          className="studio-app-rail-command"
          type="button"
          title={t('studio.commandShortcut')}
          aria-label={t('studio.commandShortcut')}
          aria-expanded={paletteOpen}
          onClick={() => setPaletteOpen(true)}
        >
          <span aria-hidden="true">⌘</span>
          <kbd>K</kbd>
        </button>
      </aside>
      <CommandPalette
        commands={commands}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onInvoke={(command) => navigateStudio(command.path())}
        label={t('studio.commandPalette')}
        placeholder={t('studio.commandPlaceholder')}
        emptyLabel={t('studio.commandNoResults')}
      />
    </>
  );
}

export function StudioNextFrame({ children }) {
  const [route, setRoute] = useState(() => readStudioRoute());
  const [authSurface, setAuthSurface] = useState(false);

  useEffect(() => {
    const updateRoute = () => setRoute(readStudioRoute());
    window.addEventListener('hashchange', updateRoute);
    window.addEventListener('popstate', updateRoute);
    return () => {
      window.removeEventListener('hashchange', updateRoute);
      window.removeEventListener('popstate', updateRoute);
    };
  }, []);

  useLayoutEffect(() => {
    const updateAuthSurface = () => setAuthSurface(Boolean(document.querySelector('.auth-layout')));
    updateAuthSurface();
    const observer = new MutationObserver(updateAuthSurface);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const section = route.section || 'content';

  return (
    <div className={`studio-next-frame section-${section} ${authSurface ? 'auth-surface' : ''}`}>
      {!authSurface && <AppRail />}
      <div className="studio-next-app">{children}</div>
    </div>
  );
}

export { collectionCommands, commandForCurrentRoute, currentDestination, isEditableTarget };
