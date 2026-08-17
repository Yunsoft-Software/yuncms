import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import { useConfirmDialog } from '../components/DialogProvider.jsx';

const USER_SORT_OPTIONS = [
  ['email-asc', 'Email A–Z'],
  ['email-desc', 'Email Z–A'],
  ['recent', 'Recent access'],
  ['oldest', 'Oldest access'],
  ['status', 'Status'],
];

function compareUsers(left, right, sort) {
  if (sort === 'recent' || sort === 'oldest') {
    const leftTime = left.last_access ? new Date(left.last_access).getTime() : 0;
    const rightTime = right.last_access ? new Date(right.last_access).getTime() : 0;
    return sort === 'recent' ? rightTime - leftTime : leftTime - rightTime;
  }
  if (sort === 'status') {
    const result = String(left.status || '').localeCompare(String(right.status || ''));
    return result || String(left.email || '').localeCompare(String(right.email || ''));
  }
  const result = String(left.email || '').localeCompare(String(right.email || ''));
  return sort === 'email-desc' ? -result : result;
}

export function UsersScreen({ currentUserId }) {
  const requestConfirmation = useConfirmDialog();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState('email-asc');
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

  const roleIndex = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);
  const visibleUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users
      .filter((user) => !query || [
        user.email,
        roleIndex.get(user.role)?.name,
        user.status,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)))
      .filter((user) => {
        if (roleFilter === 'all') return true;
        if (roleFilter === 'none') return !user.role;
        return user.role === roleFilter;
      })
      .filter((user) => statusFilter === 'all' || user.status === statusFilter)
      .slice()
      .sort((left, right) => compareUsers(left, right, sort));
  }, [roleFilter, roleIndex, search, sort, statusFilter, users]);

  const hasActiveFilters = Boolean(search.trim() || roleFilter !== 'all' || statusFilter !== 'all' || sort !== 'email-asc');

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
      setShowCreateUser(false);
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

  function resetControls() {
    setSearch('');
    setRoleFilter('all');
    setStatusFilter('all');
    setSort('email-asc');
  }

  return (
    <div className="screen-stack">
      <section className="panel workspace-toolbar">
        <div className="workspace-toolbar-heading">
          <div>
            <p className="eyebrow">Users</p>
            <h2>{visibleUsers.length === users.length ? `${users.length} users` : `${visibleUsers.length} of ${users.length} users`}</h2>
            <p>Find people quickly, filter their access state and change role or status directly from the table.</p>
          </div>
          <button className="primary-button" type="button" onClick={() => setShowCreateUser((value) => !value)}>
            {showCreateUser ? 'Close form' : 'New user'}
          </button>
        </div>

        <div className="list-controls">
          <label className="field-label">
            <span>Search</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Email, role or status…"
            />
          </label>
          <label className="field-label">
            <span>Role</span>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="all">All roles</option>
              <option value="none">No role</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>
          <label className="field-label">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label className="field-label">
            <span>Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              {USER_SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className="list-controls-summary">
          <span className="result-count">{visibleUsers.length} visible · {users.filter((user) => user.status === 'active').length} active</span>
          {hasActiveFilters && <button className="text-button" type="button" onClick={resetControls}>Reset view</button>}
        </div>
      </section>

      {showCreateUser && (
        <section className="panel form-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">New user</p>
              <h2>Create user</h2>
              <p>Set the login credentials and optional role. Passwords are hashed server-side.</p>
            </div>
            <button className="text-button" type="button" onClick={() => setShowCreateUser(false)}>Cancel</button>
          </div>
          <form className="form-grid inline-form" onSubmit={createUser}>
            <label className="field-label">
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                required
                autoFocus
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
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <button className="primary-button" type="submit">Create user</button>
          </form>
        </section>
      )}

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      {!loading && visibleUsers.length === 0 && users.length > 0 ? (
        <section className="panel empty-state empty-state-action">
          <div><h2>No matching users</h2><p>Try a broader search or reset the filters.</p></div>
          <button className="text-button" type="button" onClick={resetControls}>Reset view</button>
        </section>
      ) : (
        <section className="table-panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Email</th><th>Role</th><th>Status</th><th>Verified</th><th>Last access</th><th /></tr>
              </thead>
              <tbody>
                {visibleUsers.map((user) => (
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
          <div className="table-footer">
            {loading ? 'Loading users…' : users.length === 0 ? 'No users found.' : `Showing ${visibleUsers.length} of ${users.length} users`}
          </div>
        </section>
      )}
    </div>
  );
}
