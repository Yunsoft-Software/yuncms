import { useEffect, useMemo, useState } from 'react';

import { API_URL, apiRequest, health, logout, readSession, subscribeSession } from './api.js';
import { isContentCollection } from './collection-visibility.js';
import { AuthActionScreen } from './screens/AuthActionScreen.jsx';
import { CollectionVisibilityScreen } from './screens/CollectionVisibilityScreen.jsx';
import { ContentScreen } from './screens/ContentScreen.jsx';
import { DataModelScreen } from './screens/DataModelScreen.jsx';
import { FilesScreen } from './screens/FilesScreen.jsx';
import { LoginScreen } from './screens/LoginScreen.jsx';
import { RolesPermissionsScreen } from './screens/RolesPermissionsScreen.jsx';
import { UsersScreen } from './screens/UsersScreen.jsx';

const librarySections = [
  { id: 'files', label: 'Files' },
];

const settingsSections = [
  { id: 'content-visibility', label: 'Content Visibility' },
  { id: 'data-model', label: 'Data Model' },
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles & Permissions' },
];

const sectionCopy = {
  'content-visibility': ['Content Visibility', 'Choose which collections appear in the Content navigation without changing their data.'],
  'data-model': ['Data Model', 'Create collections, fields and relations backed by MySQL.'],
  users: ['Users', 'Manage administrator-created users, roles and account status.'],
  roles: ['Roles & Permissions', 'Configure role access, field allowlists and row filters.'],
  files: ['Files', 'Upload, preview and manage files through the configured storage driver.'],
};

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
  const [session, setSession] = useState(() => readSession());
  const [authAction, setAuthAction] = useState(() => readAuthAction());
  const [section, setSection] = useState('content');
  const [contentCollections, setContentCollections] = useState([]);
  const [contentCollection, setContentCollection] = useState('');
  const [healthState, setHealthState] = useState({ state: 'checking', message: 'Checking API…' });
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => subscribeSession(() => setSession(readSession())), []);

  useEffect(() => {
    health()
      .then(() => setHealthState({ state: 'online', message: 'API online' }))
      .catch(() => setHealthState({ state: 'offline', message: 'API unavailable' }));
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
    ? [contentCollection || 'Content', contentCollection
      ? 'Manage records in this collection.'
      : 'Create a collection in Settings to start managing content.']
    : sectionCopy[section];

  const activeScreen = useMemo(() => {
    if (section === 'content-visibility') return <CollectionVisibilityScreen />;
    if (section === 'data-model') return <DataModelScreen />;
    if (section === 'users') return <UsersScreen currentUserId={session?.user?.id} />;
    if (section === 'roles') return <RolesPermissionsScreen />;
    if (section === 'files') return <FilesScreen />;
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

  return (
    <div className="studio-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">YunCMS</div>
          <div className="brand-subtitle">Studio</div>
        </div>

        <nav aria-label="Studio sections" className="sidebar-nav">
          <div className="nav-group">
            <div className="nav-group-label">Content</div>
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
                  <span>Create first collection</span>
                </button>
              )}
            </div>
          </div>

          <div className="nav-group">
            <div className="nav-group-label">Library</div>
            {librarySections.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${section === item.id ? 'active' : ''}`}
                type="button"
                onClick={() => setSection(item.id)}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          <div className="nav-group">
            <div className="nav-group-label">Settings</div>
            {settingsSections.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${section === item.id ? 'active' : ''}`}
                type="button"
                onClick={() => setSection(item.id)}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className={`sidebar-health ${healthState.state}`} role="status">
            <span className="status-dot" aria-hidden="true" />
            <span>{healthState.message}</span>
          </div>
          <small className="sidebar-api-address">{API_URL}</small>

          <div className="sidebar-account">
            <strong>{session.user?.email || 'Authenticated user'}</strong>
            <small>{session.user?.role || 'No role'}</small>
            <button className="text-button" type="button" disabled={loggingOut} onClick={handleLogout}>
              {loggingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div>
            <p className="eyebrow">YunCMS Studio</p>
            <h1>{title}</h1>
            <p className="lede">{description}</p>
          </div>
        </header>

        {activeScreen}
      </main>
    </div>
  );
}
