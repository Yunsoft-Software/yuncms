import { useEffect, useMemo, useState } from 'react';

import { useI18n } from '../i18n.js';
import { navigateStudio, readStudioRoute, studioPath } from '../studio-route.js';
import { SidebarIcon } from './SidebarIcon.jsx';
import { StudioBrand } from './StudioBrand.jsx';

function currentDestination(id, route) {
  if (id === 'access') return route.section === 'users' || route.section === 'roles';
  if (id === 'settings') return route.section === 'appearance' || route.section === 'mcp';
  return route.section === id;
}

export function AppRail() {
  const { t } = useI18n();
  const [route, setRoute] = useState(() => readStudioRoute());

  useEffect(() => {
    const update = () => setRoute(readStudioRoute());
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
    };
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

  return (
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
    </aside>
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
