import { useState } from "react";
import { createApi } from "../api";
export default function Login({ onLogin }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      onLogin(
        await createApi()("/auth/login", {
          body: { email: data.get("email"), password: data.get("password") },
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="login-story">
        <div className="brand">
          <span className="brand-mark">Y</span> YunCMS / React
        </div>
        <h1>
          A small app.
          <br />A real backend.
        </h1>
        <p>
          Support requests, relationships and permissions — built on native
          YunCMS services.
        </p>
        <div className="pills">
          <span>MySQL</span>
          <span>REST</span>
          <span>RBAC</span>
          <span>AI automations</span>
        </div>
      </div>
      <form onSubmit={submit} className="login-card">
        <span className="eyebrow">SUPPORT DESK EXAMPLE</span>
        <h2>Welcome back</h2>
        <p>Use a local demo account to explore its permissions.</p>
        <label>
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            placeholder="agent@example.test"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <small>Credentials are generated locally by the setup script.</small>
      </form>
    </main>
  );
}
