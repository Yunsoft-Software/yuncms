import { useEffect, useMemo, useState } from 'react';

import { API_URL, apiRequest, health, logout, readSession, subscribeSession } from './api.js';
import { collectionUi, sortContentCollections } from './collection-ui.js';
import { CollectionIcon } from './components/CollectionIcon.jsx';
import { LanguageSwitcher, StudioBrand, YunsoftFooter } from './components/StudioBrand.jsx';
import { SidebarIcon } from './components/SidebarIcon.jsx';
import { useI18n } from './i18n.js';
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
  const [section, setSection] = useState('content');
  const [contentCollections, setContentCollections] = useState([]);
  const [contentCollection, setContentCollection] = useState('');
  const [healthState, setHealthState] = useState('checking');
  const [loggingOut, setLoggingOut] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [groups, setGroups] = useState({ content: true, settings: true });

  useEffect(() => subscribeSession(() => setSession(readSession())), []);

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
      setContentCollection((current) => (
        visible.some((entry) => entry.collection === current)
          ? current
          : visible[0]?.collection || ''
      ));
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
        setContentCollection((current) => (
          visible.some((entry) => entry.collection === current)
            ? current
            : visible[0]?.collection || ''
        ));
      })
      .catch(() => {
        if (!cancelled) setContentCollections([]);
      });
    return () => { cancelled = true; };
  }, [session?.user?.id, section]);

  const [title, description] = section === 'content'
    ? [contentCollection || t('nav.content'), contentCollection
      ? t('app.contentDescription')
      : t('app.contentEmpty')]
    : sectionCopy(section, t);

  const activeScreen = useMemo(() => {
    if (section === 'data-model') return <DataModelScreen onCollectionsChanged={loadNavigationCollections} />;
    if (section === 'users') return <UsersScreen currentUserId={session?.user?.id} />;
    if (section === 'roles') return <RolesPermissionsScreen />;
    if (section === 'files') return <FilesScreen />;
    if (section === 'appearance') return <AppearanceScreen />;
    return (
      <ContentScreen
        collection={contentCollection}
        onOpenDataModel={() => setSection('data-model')}
      />
    );
  }, [contentCollection, section, session?.user?.id]);

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
    setSection(nextSection);
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
    <div className={`studio-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand-row">
          <StudioBrand compact={sidebarCollapsed} />
          <button
            className="sidebar-collapse-button"
            type="button"
            aria-label={sidebarCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            aria-pressed={sidebarCollapsed}
            title={sidebarCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            <SidebarIcon name="collapse" />
          </button>
        </div>

        <nav aria-label={t('nav.studioSections')} className="sidebar-nav">
          <AccordionGroup
            id="content"
            label={t('nav.content')}
            icon="content"
            open={groups.content}
            collapsed={sidebarCollapsed}
            onToggle={() => toggleGroup('content')}
          >
            {contentCollections.map((entry) => (
              <button
                key={entry.collection}
                className={`nav-item nav-item-child collection-nav-item ${section === 'content' && contentCollection === entry.collection ? 'active' : ''}`}
                type="button"
                onClick={() => {
                  setContentCollection(entry.collection);
                  openSection('content', 'content');
                }}
              >
                <CollectionIcon name={collectionUi(entry).icon} size={16} />
                <span className="nav-item-label">{entry.collection}</span>
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
            className={`nav-item nav-item-root ${section === 'files' ? 'active' : ''}`}
            type="button"
            title={sidebarCollapsed ? t('nav.files') : undefined}
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
            collapsed={sidebarCollapsed}
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
            <YunsoftFooter compact={sidebarCollapsed} />
          </div>
        </div>
      </aside>

      <main className="main-content">
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
