import { useEffect, useMemo, useState } from 'react';

import { API_URL, health, logout, readSession, subscribeSession } from './api.js';
import { ContentScreen } from './screens/ContentScreen.jsx';
import { DataModelScreen } from './screens/DataModelScreen.jsx';
import { LoginScreen } from './screens/LoginScreen.jsx';
import { RolesPermissionsScreen } from './screens/RolesPermissionsScreen.jsx';
import { UsersScreen } from './screens/UsersScreen.jsx';

const sections = [
  { id: 'content', label: 'Content' },
  { id: 'data-model', label: 'Data Model' },
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles & Permissions' },
  { id: 'files', label: 'Files', pending: true },
];

const sectionCopy = {
  content: ['Content', 'Manage records through schema-aware generic CRUD.'],
  'data-model': ['Data Model', 'Create collections, fields and relations backed by MySQL.'],
  users: ['Users', 'Manage administrator-created users, roles and account status.'],
  roles: ['Roles & Permissions', 'Configure role access, field allowlists and row filters.'],
  files: ['Files', 'Storage drivers and FilesService are the next backend milestone.'],
};

function PendingFilesScreen() {
  return (
    <section className="panel empty-state">
      <div>
        <p className="eyebrow">Files</p>
        <h2>Storage backend not shipped yet</h2>
        <p>Local and S3-compatible storage, FilesService and upload/download routes are still pending.</p>
      </div>
    </section>
  );
}

export function App() {
  const [session, setSession] = useState(() => readSession());
  const [section, setSection] = useState('content');
  const [healthState, setHealthState] = useState({ state: 'checking', message: 'Checking API…' });
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => subscribeSession(() => setSession(readSession())), []);

  useEffect(() => {
    const controller = new AbortController();
    health({ signal: controller.signal })
      .then(() => setHealthState({ state: 'online', message: 'API online' }))
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setHealthState({ state: 'offline', message: 'API unavailable' });
      });
    return () => controller.abort();
  }, []);

  const [title, description] = sectionCopy[section];
  const activeScreen = useMemo(() => {
    if (section === 'data-model') return <DataModelScreen />;
    if (section === 'users') return <UsersScreen currentUserId={session?.user?.id} />;
    if (section === 'roles') return <RolesPermissionsScreen />;
    if (section === 'files') return <PendingFilesScreen />;
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
              {item.pending && <small>pending backend</small>}
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
