import { useEffect, useState } from 'react';

const apiUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8055';

const sections = ['Content', 'Data Model', 'Users', 'Roles & Permissions', 'Files'];

export function App() {
  const [health, setHealth] = useState({ state: 'checking', message: 'Checking API…' });

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/health`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(() => setHealth({ state: 'online', message: 'API online' }))
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setHealth({ state: 'offline', message: 'API unavailable' });
      });

    return () => controller.abort();
  }, []);

  return (
    <div className="studio-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">YunCMS</div>
          <div className="brand-subtitle">Studio</div>
        </div>

        <nav aria-label="Studio sections">
          {sections.map((section, index) => (
            <button key={section} className={index === 0 ? 'nav-item active' : 'nav-item'} type="button" disabled={index !== 0}>
              <span>{section}</span>
              {index !== 0 && <small>planned</small>}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div>
            <p className="eyebrow">YunCMS Studio</p>
            <h1>Backend control surface</h1>
            <p className="lede">The Studio is intentionally small. Data Model, users, permissions and files will appear as their backend contracts become stable.</p>
          </div>
          <div className={`status ${health.state}`} role="status">
            <span className="status-dot" aria-hidden="true" />
            {health.message}
          </div>
        </header>

        <section className="panel">
          <div>
            <p className="eyebrow">Content</p>
            <h2>No collections yet</h2>
            <p>Collections will be listed here after the schema engine and ItemsService land.</p>
          </div>
          <button className="primary-button" type="button" disabled>
            Create collection
          </button>
        </section>

        <section className="grid">
          <article className="metric-card">
            <span>API</span>
            <strong>{health.state === 'online' ? 'Connected' : 'Not connected'}</strong>
            <small>{apiUrl}</small>
          </article>
          <article className="metric-card">
            <span>Database</span>
            <strong>Readiness endpoint</strong>
            <small>Use /ready to verify MySQL access.</small>
          </article>
          <article className="metric-card">
            <span>Extensions</span>
            <strong>SDK started</strong>
            <small>Endpoint and hook helpers are defined first.</small>
          </article>
        </section>
      </main>
    </div>
  );
}
