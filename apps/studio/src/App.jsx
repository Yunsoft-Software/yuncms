import { useEffect, useLayoutEffect, useMemo, useState } from 'react';

import { API_URL, apiRequest, health, logout, readSession, subscribeSession } from './api.js';
import { collectionUi, sortContentCollections } from './collection-ui.js';
import { CollectionIcon } from './components/CollectionIcon.jsx';
import { LanguageSwitcher, StudioBrand, YunsoftFooter } from './components/StudioBrand.jsx';
import { SidebarIcon } from './components/SidebarIcon.jsx';
import { useI18n } from './i18n.js';
import { displaySchemaName } from './schema-name.js';
import { navigateStudio, readStudioRoute, studioPath } from './studio-route.js';
import { AiScreen } from './screens/AiScreen.jsx';
import { AppearanceScreen } from './screens/AppearanceScreen.jsx';
import { AuthActionScreen } from './screens/AuthActionScreen.jsx';
import { ContentScreen } from './screens/ContentScreen.jsx';
import { DataModelScreen } from './screens/DataModelScreen.jsx';
import { FilesScreen } from './screens/FilesScreen.jsx';
import { LoginScreen } from './screens/LoginScreen.jsx';
import { RolesPermissionsScreen } from './screens/RolesPermissionsScreen.jsx';
import { UsersScreen } from './screens/UsersScreen.jsx';

const settingsSections = [
  { id: 'data-model', labelKey: 'nav.dataModel', icon: 'model' },
  { id: 'users', labelKey: 'nav.users', icon: 'users' },
  { id: 'roles', labelKey: 'nav.roles', icon: 'roles' },
  { id: 'appearance', labelKey: 'nav.appearance', icon: 'appearance' },
];

function sectionCopy(section, t) {
  const copy = {
    'data-model': ['section.dataModelTitle', 'section.dataModelDescription'],
    users: ['section.usersTitle', 'section.usersDescription'],
    roles: ['section.rolesTitle', 'section.rolesDescription'],
    files: ['section.filesTitle', 'section.filesDescription'],
    ai: ['section.aiTitle', 'section.aiDescription'],
    appearance: ['section.appearanceTitle', 'section.appearanceDescription'],
  };
  const keys = copy[section];
  return keys ? keys.map((key) => t(key)) : ['', ''];
}

function readAuthAction() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('auth_action');
  const token = params.get('token');
  if (!token || !['reset', 'verify'].includes(action)) return null;
  return { action, token };
}

function clearAuthAction() {
  const url = new URL(window.location.href);
  url.searchParams.delete('auth_action');
  url.searchParams.delete('token');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function AccordionGroup({ id, label, icon, open, collapsed, onToggle, children }) {
  return (
    <div className={`nav-group ${open ? 'open' : ''}`}>
      <button
        className="nav-group-trigger"
        type="button"
        aria-expanded={open && !collapsed}
        aria-controls={`sidebar-group-${id}`}
        title={collapsed ? label : undefined}
        onClick={onToggle}
      >
        <span className="nav-group-title">
          <SidebarIcon name={icon} />
          <span className="nav-label-text">{label}</span>
        </span>
        <span className="nav-chevron"><SidebarIcon name="chevron" size={14} /></span>
      </button>
      <div id={`sidebar-group-${id}`} className="nav-group-children" hidden={!open || collapsed}>
        {children}
      </div>
    </div>
  );
}

export function App() {
  const { t } = useI18n();
  const [session, setSession] = useState(() => readSession());
  const [authAction, setAuthAction] = useState(() => readAuthAction());
  const [route, setRoute] = useState(() => readStudioRoute());
  const [contentCollections, setContentCollections] = useState([]);
  const [healthState, setHealthState] = useState('checking');
  const [loggingOut, setLoggingOut] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileLayout, setMobileLayout] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [groups, setGroups] = useState({ content: true, settings: true });

  useEffect(() => subscribeSession(() => setSession(readSession())), []);

  useEffect(() => {
    const updateRoute = () => {
      setRoute(readStudioRoute());
      setMobileNavOpen(false);
    };
    window.addEventListener('hashchange', updateRoute);
    window.addEventListener('popstate', updateRoute);
    return () => {
      window.removeEventListener('hashchange', updateRoute);
      window.removeEventListener('popstate', updateRoute);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const updateLayout = () => setMobileLayout(media.matches);
    media.addEventListener('change', updateLayout);
    return () => media.removeEventListener('change', updateLayout);
  }, []);

  useLayoutEffect(() => {
    const resetScroll = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    resetScroll();
    const frame = window.requestAnimationFrame(resetScroll);
    const settledFrame = window.setTimeout(resetScroll, 50);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settledFrame);
    };
  }, [route.action, route.collection, route.field, route.fileId, route.recordId, route.roleId, route.section, route.userId, route.view]);

  useEffect(() => {
    health()
      .then(() => setHealthState('online'))
      .catch(() => setHealthState('offline'));
  }, []);

  async function loadNavigationCollections() {
    try {
      const response = await apiRequest('/schema/collections');
      const visible = sortContentCollections(response?.data ?? []);
      setContentCollections(visible);
      if (route.section === 'content' && !visible.some((entry) => entry.collection === route.collection)) {
        navigateStudio(studioPath.content(visible[0]?.collection || ''), { replace: true });
      }
    } catch {
      setContentCollections([]);
    }
  }

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    apiRequest('/schema/collections')
      .then((response) => {
        if (cancelled) return;
        const visible = sortContentCollections(response?.data ?? []);
        setContentCollections(visible);
        if (route.section === 'content' && !visible.some((entry) => entry.collection === route.collection)) {
          navigateStudio(studioPath.content(visible[0]?.collection || ''), { replace: true });
        }
      })
      .catch(() => {
        if (!cancelled) setContentCollections([]);
      });
    return () => { cancelled = true; };
  }, [session?.user?.id, route.section]);

  const section = route.section;
  const navigationCollapsed = !mobileLayout && sidebarCollapsed;
  const contentCollection = route.collection || '';
  const activeContentCollection = contentCollections.find((entry) => entry.collection === contentCollection) ?? null;
  const contentTitle = activeContentCollection
    ? displaySchemaName(activeContentCollection, 'collection')
    : contentCollection;
  const [title, description] = section === 'content'
    ? [contentTitle || t('nav.content'), contentCollection
      ? t('app.contentDescription')
      : t('app.contentEmpty')]
    : sectionCopy(section, t);

  const activeScreen = useMemo(() => {
    if (section === 'data-model') return <DataModelScreen route={route} onNavigate={navigateStudio} onCollectionsChanged={loadNavigationCollections} />;
    if (section === 'users') return <UsersScreen route={route} onNavigate={navigateStudio} currentUserId={session?.user?.id} />;
    if (section === 'roles') return <RolesPermissionsScreen route={route} onNavigate={navigateStudio} />;
    if (section === 'files') return <FilesScreen route={route} onNavigate={navigateStudio} />;
    if (section === 'ai') return <AiScreen />;
    if (section === 'appearance') return <AppearanceScreen />;
    return (
      <ContentScreen
        collection={contentCollection}
        collectionLabel={contentTitle}
        route={route}
        onNavigate={navigateStudio}
        onOpenDataModel={() => navigateStudio(studioPath.dataModel())}
      />
    );
  }, [contentCollection, contentTitle, route, section, session?.user?.id]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  function toggleGroup(group) {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      setGroups((current) => ({ ...current, [group]: true }));
      return;
    }
    setGroups((current) => ({ ...current, [group]: !current[group] }));
  }

  function openSection(nextSection, group = null) {
    const destinations = {
      'data-model': studioPath.dataModel(),
      users: studioPath.users(),
      roles: studioPath.roles(),
      files: studioPath.files(),
      ai: studioPath.ai(),
      appearance: studioPath.appearance(),
      content: studioPath.content(contentCollection),
    };
    navigateStudio(destinations[nextSection] || studioPath.content(contentCollection));
    if (group) setGroups((current) => ({ ...current, [group]: true }));
  }

  if (authAction) {
    return (
      <AuthActionScreen
        action={authAction.action}
        token={authAction.token}
        onDone={() => {
          clearAuthAction();
          setAuthAction(null);
        }}
      />
    );
  }

  if (!session) {
    return <LoginScreen onAuthenticated={setSession} />;
  }

  const healthMessage = healthState === 'online'
    ? t('app.apiOnline')
    : healthState === 'offline'
      ? t('app.apiUnavailable')
      : t('app.apiChecking');

  return (
    <div className={`studio-shell ${navigationCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${mobileNavOpen ? 'mobile-nav-open' : ''}`}>
        <div className="sidebar-brand-row">
          <StudioBrand compact={navigationCollapsed} />
          <button
            className="sidebar-collapse-button"
            type="button"
            aria-label={mobileLayout ? (mobileNavOpen ? t('nav.closeMenu') : t('nav.openMenu')) : (sidebarCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar'))}
            aria-pressed={mobileLayout ? undefined : sidebarCollapsed}
            aria-expanded={mobileLayout ? mobileNavOpen : undefined}
            aria-controls="studio-sidebar-navigation"
            title={mobileLayout ? (mobileNavOpen ? t('nav.closeMenu') : t('nav.openMenu')) : (sidebarCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar'))}
            onClick={() => {
              if (mobileLayout) {
                setMobileNavOpen((value) => !value);
                return;
              }
              setSidebarCollapsed((value) => !value);
            }}
          >
            <SidebarIcon name="collapse" />
            <span className="mobile-menu-label">{mobileNavOpen ? t('nav.closeMenu') : t('nav.openMenu')}</span>
          </button>
        </div>

        <nav id="studio-sidebar-navigation" aria-label={t('nav.studioSections')} className="sidebar-nav">
          <AccordionGroup
            id="content"
            label={t('nav.content')}
            icon="content"
            open={groups.content}
            collapsed={navigationCollapsed}
            onToggle={() => toggleGroup('content')}
          >
            {contentCollections.map((entry) => (
              <button
                key={entry.collection}
                className={`nav-item nav-item-child collection-nav-item ${section === 'content' && contentCollection === entry.collection ? 'active' : ''}`}
                type="button"
                title={entry.collection}
                onClick={() => {
                  navigateStudio(studioPath.content(entry.collection));
                  setGroups((current) => ({ ...current, content: true }));
                }}
              >
                <CollectionIcon name={collectionUi(entry).icon} size={16} />
                <span className="nav-item-label">{displaySchemaName(entry, 'collection')}</span>
              </button>
            ))}
            {contentCollections.length === 0 && (
              <button
                className={`nav-item nav-item-child ${section === 'data-model' ? 'active' : ''}`}
                type="button"
                onClick={() => openSection('data-model', 'settings')}
              >
                <SidebarIcon name="model" size={16} />
                <span className="nav-item-label">{t('nav.createFirstCollection')}</span>
              </button>
            )}
          </AccordionGroup>

          <button
            className={`nav-item nav-item-root ${section === 'ai' ? 'active' : ''}`}
            type="button"
            title={navigationCollapsed ? t('nav.ai') : undefined}
            onClick={() => openSection('ai')}
          >
            <SidebarIcon name="ai" />
            <span className="nav-item-label">{t('nav.ai')}</span>
          </button>

          <button
            className={`nav-item nav-item-root ${section === 'files' ? 'active' : ''}`}
            type="button"
            title={navigationCollapsed ? t('nav.files') : undefined}
            onClick={() => openSection('files')}
          >
            <SidebarIcon name="files" />
            <span className="nav-item-label">{t('nav.files')}</span>
          </button>

          <AccordionGroup
            id="settings"
            label={t('nav.settings')}
            icon="appearance"
            open={groups.settings}
            collapsed={navigationCollapsed}
            onToggle={() => toggleGroup('settings')}
          >
            {settingsSections.map((item) => (
              <button
                key={item.id}
                className={`nav-item nav-item-child ${section === item.id ? 'active' : ''}`}
                type="button"
                onClick={() => openSection(item.id, 'settings')}
              >
                <SidebarIcon name={item.icon} size={16} />
                <span className="nav-item-label">{t(item.labelKey)}</span>
              </button>
            ))}
          </AccordionGroup>
        </nav>

        <div className="sidebar-footer">
          <div className={`sidebar-health ${healthState}`} role="status" title={healthMessage}>
            <span className="status-dot" aria-hidden="true" />
            <span className="sidebar-footer-text">{healthMessage}</span>
          </div>
          <small className="sidebar-api-address">{API_URL}</small>

          <div className="sidebar-account">
            <strong>{session.user?.email || t('app.authenticatedUser')}</strong>
            <small>{session.user?.role_name || t('app.noRole')}</small>
            <button className="text-button sidebar-signout" type="button" disabled={loggingOut} onClick={handleLogout}>
              {loggingOut ? t('app.signingOut') : t('app.signOut')}
            </button>
          </div>

          <div className="sidebar-branding-footer">
            <LanguageSwitcher compact />
            <YunsoftFooter compact={navigationCollapsed} />
          </div>
        </div>
      </aside>

      <main className={`main-content section-${section} route-${route.view || 'list'}`}>
        <header className="page-header">
          <div>
            <p className="eyebrow">YunCMS {t('app.studio')}</p>
            <h1>{title}</h1>
            <p className="lede">{description}</p>
          </div>
        </header>

        {activeScreen}
      </main>
    </div>
  );
}