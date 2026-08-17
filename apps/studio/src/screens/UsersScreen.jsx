import { useEffect, useState } from 'react';

import { apiRequest } from '../api.js';
import { useConfirmDialog } from '../components/DialogProvider.jsx';

export function UsersScreen({ currentUserId }) {
  const requestConfirmation = useConfirmDialog();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: '', password: '', role: '', status: 'active' });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [usersResponse, rolesResponse] = await Promise.all([
        apiRequest('/users'),
        apiRequest('/roles'),
      ]);
      setUsers(usersResponse?.data ?? []);
      setRoles(rolesResponse?.data ?? []);
    } catch (requestError) {
      setError(requestError.message || 'Users could not be loaded');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createUser(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await apiRequest('/users', {
        method: 'POST',
        body: {
          email: form.email,
          password: form.password,
          role: form.role || null,
          status: form.status,
        },
      });
      setForm({ email: '', password: '', role: '', status: 'active' });
      setNotice('User created');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'User could not be created');
    }
  }

  async function updateUser(user, patch) {
    setError('');
    setNotice('');
    try {
      await apiRequest(`/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: patch,
      });
      setNotice(`Updated ${user.email}`);
      await load();
    } catch (requestError) {
      setError(requestError.message || 'User could not be updated');
    }
  }

  async function sendVerification(user) {
    setError('');
    setNotice('');
    try {
      await apiRequest('/auth/email-verification/request', {
        method: 'POST',
        body: { user: user.id },
      });
      setNotice(`Verification email queued for ${user.email}`);
    } catch (requestError) {
      setError(requestError.message || 'Verification email could not be sent');
    }
  }

  async function deleteUser(user) {
    const accepted = await requestConfirmation({
      title: 'Delete user?',
      description: `${user.email} will permanently lose access to this project.`,
      confirmLabel: 'Delete user',
      tone: 'danger',
    });
    if (!accepted) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(`/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
      setNotice(`Deleted ${user.email}`);
      await load();
    } catch (requestError) {
      setError(requestError.message || 'User could not be deleted');
    }
  }

  return (
    <div className="screen-stack">
      <section className="panel form-panel">
        <div>
          <p className="eyebrow">Users</p>
          <h2>Create user</h2>
          <p>New users receive a password and optional role. Passwords are hashed server-side.</p>
        </div>
        <form className="form-grid inline-form" onSubmit={createUser}>
          <label className="field-label">
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              required
            />
          </label>
          <label className="field-label">
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              required
            />
          </label>
          <label className="field-label">
            <span>Role</span>
            <select
              value={form.role}
              onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}
            >
              <option value="">No role</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>
          <label className="field-label">
            <span>Status</span>
            <select
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="active">active</option>
              <option value="suspended">suspended</option>
              <option value="disabled">disabled</option>
            </select>
          </label>
          <button className="primary-button" type="submit">Create user</button>
        </form>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      <section className="table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Email</th><th>Role</th><th>Status</th><th>Verified</th><th>Last access</th><th /></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.email}</strong>
                    {user.id === currentUserId && <small className="inline-note">you</small>}
                  </td>
                  <td>
                    <select
                      aria-label={`Role for ${user.email}`}
                      value={user.role ?? ''}
                      onChange={(event) => updateUser(user, { role: event.target.value || null })}
                    >
                      <option value="">No role</option>
                      {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`Status for ${user.email}`}
                      value={user.status}
                      disabled={user.id === currentUserId}
                      onChange={(event) => updateUser(user, { status: event.target.value })}
                    >
                      <option value="active">active</option>
                      <option value="suspended">suspended</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </td>
                  <td>{user.email_verified_at ? 'Yes' : 'No'}</td>
                  <td>{user.last_access ? new Date(user.last_access).toLocaleString() : '—'}</td>
                  <td className="row-actions">
                    {!user.email_verified_at && (
                      <button className="text-button" type="button" onClick={() => sendVerification(user)}>Send verification</button>
                    )}
                    <button
                      className="danger-button"
                      type="button"
                      disabled={user.id === currentUserId}
                      onClick={() => deleteUser(user)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <div className="table-footer">Loading users…</div>}
        {!loading && users.length === 0 && <div className="table-footer">No users found.</div>}
      </section>
    </div>
  );
}
