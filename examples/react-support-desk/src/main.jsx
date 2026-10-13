import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createApi, projection } from "./api";
import { nextState } from "./logic";
import Login from "./components/Login";
import RequestForm from "./components/RequestForm";
import RequestDetail from "./components/RequestDetail";
import "./style.css";

function App() {
  const [session, setSession] = useState(null),
    [items, setItems] = useState([]),
    [categories, setCategories] = useState([]),
    [selected, setSelected] = useState(null),
    [comments, setComments] = useState([]),
    [error, setError] = useState(""),
    [form, setForm] = useState(false),
    [filter, setFilter] = useState(""),
    [busy, setBusy] = useState(false);
  const api = useMemo(() => createApi(session?.access_token), [session]);
  const current = items.find((i) => i.id === selected);
  async function reload() {
    setBusy(true);
    setError("");
    try {
      const [rows, cats] = await Promise.all([
        api(
          `/items/requests?${new URLSearchParams({ fields: projection, sort: "-created_at", limit: "50", ...(filter ? { filter: JSON.stringify({ status: { _eq: filter } }) } : {}) })}`,
        ),
        api("/items/categories?fields=id,name,color&sort=name"),
      ]);
      setItems(rows);
      setCategories(cats);
      setSelected((id) => (rows.some((i) => i.id === id) ? id : rows[0]?.id));
    } catch (e) {
      setError(e.message);
      if (e.status === 401) setSession(null);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (session) reload();
  }, [session, filter]);
  useEffect(() => {
    if (!selected || !session) {
      setComments([]);
      return;
    }
    let active = true;
    setComments([]);
    api(`/items/requests/${selected}?fields=id,comments.id,comments.body`)
      .then((data) => {
        if (active) setComments(data.comments || []);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [api, selected, session]);
  if (!session)
    return (
      <Login
        onLogin={(data) => {
          setSession(data);
        }}
      />
    );
  // Presentation follows the seeded role names; every mutation is still authorized by YunCMS.
  const writableRole =
    session.user?.role_name === "Support Agent" || session.user?.admin === true;
  const canCreate = writableRole,
    canUpdate = writableRole;
  async function advance() {
    setBusy(true);
    try {
      await api(`/items/requests/${current.id}`, {
        method: "PATCH",
        body: nextState(current.status),
      });
      await reload();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api("/auth/logout", {
        body: { refresh_token: session.refresh_token },
      });
    } finally {
      setSession(null);
      setItems([]);
      setSelected(null);
    }
  }
  return (
    <div className="shell">
      <nav className="rail">
        <a className="brand" href="#">
          <span className="brand-mark">Y</span> YunCMS
        </a>
        <div className="nav-label">EXAMPLE APPLICATION</div>
        <div className="active-nav">
          ▤ <span>Support desk</span>
        </div>
        <div className="rail-note">
          <span>Powered by</span>
          <strong>Native YunCMS</strong>
          <p>
            Auth · REST · MySQL
            <br />
            Relations · RBAC · AI
          </p>
        </div>
        <a
          className="rail-footer"
          href="https://yunsoft.com/contact"
          target="_blank"
          rel="noreferrer"
        >
          Built by Yunsoft ↗
        </a>
      </nav>
      <main className="workspace">
        <header>
          <div>
            <span className="eyebrow">YUNCMS + REACT</span>
            <h1>
              Support desk<span className="count">{items.length}</span>
            </h1>
            <p>A working example of data, permissions and AI.</p>
          </div>
          <div className="account">
            <span>{session.user?.role_name || "Demo account"}</span>
            <button onClick={logout}>Sign out</button>
          </div>
        </header>
        <div className="stats">
          <div>
            <span>Open requests</span>
            <strong>{items.filter((i) => i.status === "open").length}</strong>
            <small>Within this account’s scope</small>
          </div>
          <div>
            <span>Data model</span>
            <strong>3 collections</strong>
            <small>Categories · requests · comments</small>
          </div>
          <div>
            <span>AI summaries</span>
            <strong>{items.filter((i) => i.summary).length}</strong>
            <small>Native automation output</small>
          </div>
        </div>
        <div className="toolbar">
          <div className="filters">
            <button
              className={!filter ? "selected" : ""}
              onClick={() => setFilter("")}
            >
              All requests
            </button>
            {["open", "in_progress", "closed"].map((s) => (
              <button
                className={filter === s ? "selected" : ""}
                key={s}
                onClick={() => setFilter(s)}
              >
                {s.replaceAll("_", " ")}
              </button>
            ))}
          </div>
          <div>
            <button onClick={reload} disabled={busy}>
              ↻ Refresh
            </button>
            {canCreate && (
              <button className="primary" onClick={() => setForm(true)}>
                + New request
              </button>
            )}
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="board">
          <section className="request-list">
            <div className="list-heading">
              <span>REQUEST</span>
              <span>PRIORITY</span>
            </div>
            {items.map((item) => (
              <button
                key={item.id}
                className={
                  "request-row " + (selected === item.id ? "is-selected" : "")
                }
                onClick={() => setSelected(item.id)}
              >
                <div>
                  <span className="request-category">
                    {item.category_id?.name || "Uncategorized"}
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.message}</p>
                  <div className="row-meta">
                    <span className={"badge " + item.status}>
                      {item.status.replaceAll("_", " ")}
                    </span>
                    <span>
                      {item.summary ? "✦ Summary ready" : "Summary pending"}
                    </span>
                  </div>
                </div>
                <span className={"priority p" + item.priority}>
                  P{item.priority}
                </span>
              </button>
            ))}
            {!items.length && (
              <p className="empty">
                No requests match this account and filter.
              </p>
            )}
            <div className="scope-note">
              Server-enforced access. API projections and relation reads use the
              current account’s permissions.
            </div>
          </section>
          <RequestDetail
            item={current}
            comments={comments}
            writable={canUpdate}
            onAdvance={advance}
            busy={busy}
          />
        </div>
        <footer>
          Developed by <a href="https://yunsoft.com">Yunsoft</a>. Have a
          project?{" "}
          <a href="https://yunsoft.com/contact">Let’s build it together ↗</a>
        </footer>
      </main>
      {form && (
        <RequestForm
          categories={categories}
          onClose={() => setForm(false)}
          onSave={async (body) => {
            const row = await api("/items/requests", { body });
            await reload();
            setSelected(row.id);
          }}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
