import { useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '../i18n.js';
import { navigateStudio, readStudioRoute, studioPath } from '../studio-route.js';
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

function CommandPalette({ commands, open, onClose, t }) {
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const visibleCommands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) => command.label.toLocaleLowerCase().includes(normalized));
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (activeIndex < visibleCommands.length) return;
    setActiveIndex(Math.max(0, visibleCommands.length - 1));
  }, [activeIndex, visibleCommands.length]);

  if (!open) return null;

  function invoke(command) {
    if (!command) return;
    onClose();
    navigateStudio(command.path());
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' && visibleCommands.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % visibleCommands.length);
      return;
    }
    if (event.key === 'ArrowUp' && visibleCommands.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + visibleCommands.length) % visibleCommands.length);
      return;
    }
    if (event.key === 'Enter' && document.activeElement === inputRef.current) {
      event.preventDefault();
      invoke(visibleCommands[activeIndex]);
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...dialogRef.current.querySelectorAll('input, button:not(:disabled)')];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="studio-command-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <section
        className="studio-command-palette"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('studio.commandPalette')}
      >
        <div className="studio-command-search">
          <SidebarIcon name="content" size={16} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            placeholder={t('studio.commandPlaceholder')}
            aria-label={t('studio.commandPalette')}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="studio-command-results">
          {visibleCommands.map((command, index) => (
            <button
              className={`studio-command-item ${index === activeIndex ? 'active' : ''}`}
              type="button"
              key={command.id}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => invoke(command)}
            >
              <SidebarIcon name={command.icon} size={17} />
              <span>{command.label}</span>
            </button>
          ))}
          {visibleCommands.length === 0 && <p className="studio-command-empty">{t('studio.commandNoResults')}</p>}
        </div>
        <footer className="studio-command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd></span>
          <span><kbd>Enter</kbd></span>
        </footer>
      </section>
    </div>
  );
}

export function AppRail() {
  const { t } = useI18n();
  const [route, setRoute] = useState(() => readStudioRoute());
  const [paletteOpen, setPaletteOpen] = useState(false);

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
    ];
  }, [destinations, route, t]);

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
                className={`studio-app-rail-button ${active ? 'active' : ''}`
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
      <CommandPalette commands={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} t={t} />
    </>
  );
}

export function StudioNextFrame({ children }) {
  return (
    <div className="studio-next-frame">
      <AppRail />
      <div className="studio-next-app">{children}</div>
    </div>
  );
}

export { commandForCurrentRoute, currentDestination, isEditableTarget };
