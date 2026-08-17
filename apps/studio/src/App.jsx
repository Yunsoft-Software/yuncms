import { useEffect, useMemo, useState } from 'react';

import { API_URL, apiRequest, health, logout, readSession, subscribeSession } from './api.js';
import { isContentCollection } from './collection-visibility.js';
import { LanguageSwitcher, StudioBrand, YunsoftFooter } from './components/StudioBrand.jsx';
import { useI18n } from './i18n.js';
import { AppearanceScreen } from './screens/AppearanceScreen.jsx';
import { AuthActionScreen } from './screens/AuthActionScreen.jsx';
import { CollectionVisibilityScreen } from './screens/CollectionVisibilityScreen.jsx';
import { ContentScreen } from './screens/ContentScreen.jsx';
import { DataModelScreen } from './screens/DataModelScreen.jsx';
import { FilesScreen } from './screens/FilesScreen.jsx';
import { LoginScreen } from './screens/LoginScreen.jsx';
import { RolesPermissionsScreen } from './screens/RolesPermissionsScreen.jsx';
import { UsersScreen } from './screens/UsersScreen.jsx';

const librarySections = [
  { id: 'files', labelKey: 'nav.files' },
];

const settingsSections = [
  { id: 'content-visibility', labelKey: 'nav.contentVisibility' },
  { id: 'data-model', labelKey: 'nav.dataModel' },
  { id: 'users', labelKey: 'nav.users' },
  { id: 'roles', labelKey: 'nav.roles' },
  { id: 'appearance', labelKey: 'nav.appearance' },
];

function sectionCopy(section, t) {
  const copy = {
    'content-visibility': ['section.visibilityTitle', 'section.visibilityDescription'],
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

export function App() {
  const { t } = useI18n();
  const [session, setSession] = useState(() => readSession());
  const [authAction, setAuthAction] = useState(() => readAuthAction());
  const [section, setSection] = useState('content');
  const [contentCollections, setContentCollections] = useState([]);
  const [contentCollection, setContentCollection] = useState('');
  const [healthState, setHealthState] = useState('checking');
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => subscribeSession(() => setSession(readSession())), []);

  useEffect(() => {
    health()
      .then(() => setHealthState('online'))
      .catch(() => setHealthState('offline'));
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    async function loadNavigationCollections() {
      try {
        const response = await apiRequest('/schema/collections');
        if (cancelled) return;
        const visible = (response?.data ?? []).filter(isContentCollection);
        setContentCollections(visible);
        setContentCollection((current) => (
          visible.some((entry) => entry.collection === current)
            ? current
            : visible[0]?.collection || ''
        ));
      } catch {
        if (!cancelled) setContentCollections([]);
      }
    }

    loadNavigationCollections();
    return () => { cancelled = true; };
  }, [session?.user?.id, section]);

  const [title, description] = section === 'content'
    ? [contentCollection || t('nav.content'), contentCollection
      ? t('app.contentDescription')
      : t('app.contentEmpty')]
    : sectionCopy(section, t);

  const activeScreen = useMemo(() => {
    if (section === 'content-visibility') return <CollectionVisibilityScreen />;
    if (section === 'data-model') return <DataModelScreen />;
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
    <div className="studio-shell">
      <aside className="sidebar">
        <StudioBrand />

        <nav aria-label="Studio sections" className="sidebar-nav">
          <div className="nav-group">
            <div className="nav-group-label">{t('nav.content')}</div>
            <div className="nav-children">
              {contentCollections.map((entry) => (
                <button
                  key={entry.collection}
                  className={`nav-item nav-item-child ${section === 'content' && contentCollection === entry.collection ? 'active' : ''}`}
                  type="button"
                  onClick={() => {
                    setContentCollection(entry.collection);
                    setSection('content');
                  }}
                >
                  <span>{entry.collection}</span>
                </button>
              ))}
              {contentCollections.length === 0 && (
                <button
                  className={`nav-item nav-item-child ${section === 'data-model' ? 'active' : ''}`}
                  type="button"
                  onClick={() => setSection('data-model')}
                >
                  <span>{t('nav.createFirstCollection')}</span>
                </button>
              )}
            </div>
          </div>

          <div className="nav-group">
            <div className="nav-group-label">{t('nav.library')}</div>
            {librarySections.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${section === item.id ? 'active' : ''}`}
                type="button"
                onClick={() => setSection(item.id)}
              >
                <span>{t(item.labelKey)}</span>
              </button>
            ))}
          </div>

          <div className="nav-group">
            <div className="nav-group-label">{t('nav.settings')}</div>
            {settingsSections.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${section === item.id ? 'active' : ''}`}
                type="button"
                onClick={() => setSection(item.id)}
              >
                <span>{t(item.labelKey)}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className={`sidebar-health ${healthState}`} role="status">
            <span className="status-dot" aria-hidden="true" />
            <span>{healthMessage}</span>
          </div>
          <small className="sidebar-api-address">{API_URL}</small>

          <div className="sidebar-account">
            <strong>{session.user?.email || t('app.authenticatedUser')}</strong>
            <small>{session.user?.role || t('app.noRole')}</small>
            <button className="text-button" type="button" disabled={loggingOut} onClick={handleLogout}>
              {loggingOut ? t('app.signingOut') : t('app.signOut')}
            </button>
          </div>

          <div className="sidebar-branding-footer">
            <LanguageSwitcher compact />
            <YunsoftFooter />
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
