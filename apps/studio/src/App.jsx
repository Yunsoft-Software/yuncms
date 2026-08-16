import { useEffect, useMemo, useState } from 'react';

import { API_URL, health, logout, readSession, subscribeSession } from './api.js';
import { AuthActionScreen } from './screens/AuthActionScreen.jsx';
import { ContentScreen } from './screens/ContentScreen.jsx';
import { DataModelScreen } from './screens/DataModelScreen.jsx';
import { FilesScreen } from './screens/FilesScreen.jsx';
import { LoginScreen } from './screens/LoginScreen.jsx';
import { RolesPermissionsScreen } from './screens/RolesPermissionsScreen.jsx';
import { UsersScreen } from './screens/UsersScreen.jsx';

const sections = [
  { id: 'content', label: 'Content' },
  { id: 'data-model', label: 'Data Model' },
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles & Permissions' },
  { id: 'files', label: 'Files' },
];

const sectionCopy = {
  content: ['Content', 'Manage records through schema-aware generic CRUD.'],
  'data-model': ['Data Model', 'Create collections, fields and relations backed by MySQL.'],
  users: ['Users', 'Manage administrator-created users, roles and account status.'],
  roles: ['Roles & Permissions', 'Configure role access, field allowlists and row filters.'],
  files: ['Files', 'Upload, download and manage files through the configured storage driver.'],
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
  const [healthState, setHealthState] = useState({ state: 'checking', message: 'Checking API…' });
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => subscribeSession(() => setSession(readSession())), []);

  useEffect(() => {
    health()
      .then(() => setHealthState({ state: 'online', message: 'API online' }))
      .catch(() => setHealthState({ state: 'offline', message: 'API unavailable' }));
  }, []);

  const [title, description] = sectionCopy[section];
  const activeScreen = useMemo(() => {
    if (section === 'data-model') return <DataModelScreen />;
    if (section === 'users') return <UsersScreen currentUserId={session?.user?.id} />;
    if (section === 'roles') return <RolesPermissionsScreen />;
    if (section === 'files') return <FilesScreen />;
    return <ContentScreen />;
  }, [section, session?.user?.id]);

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

        <nav aria-label="Studio sections">
          {sections.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${section === item.id ? 'active' : ''}`}
              type="button"
              onClick={() => setSection(item.id)}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-account">
          <strong>{session.user?.email || 'Authenticated user'}</strong>
          <small>{session.user?.role || 'No role'}</small>
          <button className="text-button" type="button" disabled={loggingOut} onClick={handleLogout}>
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div>
            <p className="eyebrow">YunCMS Studio</p>
            <h1>{title}</h1>
            <p className="lede">{description}</p>
          </div>
          <div className="header-statuses">
            <div className={`status ${healthState.state}`} role="status">
              <span className="status-dot" aria-hidden="true" />
              {healthState.message}
            </div>
            <small className="api-address">{API_URL}</small>
          </div>
        </header>

        {activeScreen}
      </main>
    </div>
  );
}
