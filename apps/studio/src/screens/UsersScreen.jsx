import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import { useConfirmDialog } from '../components/DialogProvider.jsx';
import { Pagination, paginateClientItems } from '../components/Pagination.jsx';
import { useI18n } from '../i18n.js';

const USER_SORT_OPTIONS = [
  ['email-asc', 'users.emailAsc'],
  ['email-desc', 'users.emailDesc'],
  ['recent', 'users.recentAccess'],
  ['oldest', 'users.oldestAccess'],
  ['status', 'common.status'],
];

const USER_PAGE_SIZES = [10, 25, 50, 100];

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

function statusLabel(status, t) {
  return t(`users.${status === 'disabled' ? 'disabled' : status}`);
}

export function UsersScreen({ currentUserId }) {
  const { locale, t } = useI18n();
  const requestConfirmation = useConfirmDialog();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [rolesAvailable, setRolesAvailable] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState('email-asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [form, setForm] = useState({ email: '', password: '', role: '', status: 'active' });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [usersResult, rolesResult] = await Promise.allSettled([
        apiRequest('/users'),
        apiRequest('/roles'),
      ]);
      if (usersResult.status === 'rejected') throw usersResult.reason;

      setUsers(usersResult.value?.data ?? []);
      if (rolesResult.status === 'fulfilled') {
        setRoles(rolesResult.value?.data ?? []);
        setRolesAvailable(true);
      } else {
        setRoles([]);
        setRolesAvailable(false);
        setRoleFilter((current) => (current === 'all' || current === 'none' ? current : 'all'));
        setForm((current) => ({ ...current, role: '' }));
      }
    } catch (requestError) {
      setError(requestError.message || t('users.loadError'));
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
      .filter((user) => !query || [user.email, roleIndex.get(user.role)?.name, user.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)))
      .filter((user) => {
        if (roleFilter === 'all') return true;
        if (roleFilter === 'none') return !user.role;
        return user.role === roleFilter;
      })
      .filter((user) => statusFilter === 'all' || user.status === statusFilter)
      .slice()
      .sort((left, right) => compareUsers(left, right, sort));
  }, [roleFilter, roleIndex, search, sort, statusFilter, users]);

  const paged = useMemo(() => paginateClientItems(visibleUsers, page, pageSize), [page, pageSize, visibleUsers]);
  const pageUsers = paged.items;
  const hasActiveFilters = Boolean(search.trim() || roleFilter !== 'all' || statusFilter !== 'all' || sort !== 'email-asc');

  useEffect(() => {
    setPage(1);
  }, [roleFilter, search, sort, statusFilter]);

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
          role: rolesAvailable ? (form.role || null) : null,
          status: form.status,
        },
      });
      setForm({ email: '', password: '', role: '', status: 'active' });
      setShowCreateUser(false);
      setPage(1);
      setNotice(t('users.createdNotice'));
      await load();
    } catch (requestError) {
      setError(requestError.message || t('users.createError'));
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
      setNotice(t('users.updatedNotice', { email: user.email }));
      await load();
    } catch (requestError) {
      setError(requestError.message || t('users.updateError'));
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
      setNotice(t('users.verificationQueued', { email: user.email }));
    } catch (requestError) {
      setError(requestError.message || t('users.verificationError'));
    }
  }

  async function deleteUser(user) {
    const accepted = await requestConfirmation({
      title: t('users.deleteTitle'),
      description: t('users.deleteDescriptionEmail', { email: user.email }),
      confirmLabel: t('users.deleteUser'),
      tone: 'danger',
    });
    if (!accepted) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(`/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
      setNotice(t('users.deletedNotice', { email: user.email }));
      await load();
    } catch (requestError) {
      setError(requestError.message || t('users.deleteError'));
    }
  }

  function resetControls() {
    setSearch('');
    setRoleFilter('all');
    setStatusFilter('all');
    setSort('email-asc');
    setPage(1);
  }

  const dateLocale = locale === 'tr' ? 'tr-TR' : 'en-US';

  return (
    <div className="screen-stack">
      <section className="panel workspace-toolbar users-header-panel">
        <div className="workspace-toolbar-heading">
          <div>
            <p className="eyebrow">{t('nav.settings')}</p>
            <h2>{t('nav.users')}</h2>
            <p>{t('users.summary', {
              total: users.length,
              active: users.filter((user) => user.status === 'active').length,
            })}</p>
          </div>
          <button className="primary-button" type="button" onClick={() => setShowCreateUser((value) => !value)}>
            {showCreateUser ? t('users.closeForm') : t('users.newUser')}
          </button>
        </div>

        {!rolesAvailable && <div className="inline-info">{t('users.roleAccessUnavailable')}</div>}

        <div className="list-controls user-list-controls">
          <label className="field-label">
            <span>{t('common.search')}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('users.searchPlaceholder')}
            />
          </label>
          <label className="field-label">
            <span>{t('users.role')}</span>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="all">{t('users.allRoles')}</option>
              <option value="none">{t('app.noRole')}</option>
              {rolesAvailable && roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>
          <label className="field-label">
            <span>{t('common.status')}</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">{t('users.allStatuses')}</option>
              <option value="active">{t('users.active')}</option>
              <option value="suspended">{t('users.suspended')}</option>
              <option value="disabled">{t('users.disabled')}</option>
            </select>
          </label>
          <label className="field-label">
            <span>{t('common.sort')}</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              {USER_SORT_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
            </select>
          </label>
        </div>
        <div className="list-controls-summary">
          <span className="result-count">{t('users.matchingCount', { count: visibleUsers.length })}</span>
          {hasActiveFilters && <button className="text-button" type="button" onClick={resetControls}>{t('users.resetView')}</button>}
        </div>
      </section>

      {showCreateUser && (
        <section className="panel form-panel create-user-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{t('users.newUser')}</p>
              <h2>{t('users.createUser')}</h2>
              <p>{t('users.createDescription')}</p>
            </div>
            <button className="text-button" type="button" onClick={() => setShowCreateUser(false)}>{t('common.cancel')}</button>
          </div>
          <form className="form-grid inline-form" onSubmit={createUser}>
            <label className="field-label">
              <span>{t('auth.email')}</span>
              <input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required autoFocus />
            </label>
            <label className="field-label">
              <span>{t('auth.password')}</span>
              <input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required />
            </label>
            {rolesAvailable ? (
              <label className="field-label">
                <span>{t('users.role')}</span>
                <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}>
                  <option value="">{t('app.noRole')}</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </label>
            ) : (
              <div className="field-label">
                <span>{t('users.role')}</span>
                <div className="inline-info compact-info">{t('users.roleUnavailableForCreate')}</div>
              </div>
            )}
            <label className="field-label">
              <span>{t('common.status')}</span>
              <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                <option value="active">{t('users.active')}</option>
                <option value="suspended">{t('users.suspended')}</option>
                <option value="disabled">{t('users.disabled')}</option>
              </select>
            </label>
            <button className="primary-button" type="submit">{t('users.createUser')}</button>
          </form>
        </section>
      )}

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      {!loading && visibleUsers.length === 0 && users.length > 0 ? (
        <section className="panel empty-state empty-state-action">
          <div><h2>{t('users.noUsers')}</h2><p>{t('users.noMatchDescription')}</p></div>
          <button className="text-button" type="button" onClick={resetControls}>{t('users.resetView')}</button>
        </section>
      ) : (
        <section className="table-panel users-table-panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>{t('users.user')}</th><th>{t('users.role')}</th><th>{t('common.status')}</th><th>{t('users.verification')}</th><th>{t('users.lastAccess')}</th><th /></tr>
              </thead>
              <tbody>
                {pageUsers.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="user-identity-cell">
                        <strong>{user.email}</strong>
                        <div className="user-cell-badges">
                          {user.id === currentUserId && <span className="inline-note">{t('users.you')}</span>}
                          <span className={`status-pill user-status-pill ${user.status}`}>{statusLabel(user.status, t)}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      {rolesAvailable ? (
                        <select aria-label={t('users.roleFor', { email: user.email })} value={user.role ?? ''} onChange={(event) => updateUser(user, { role: event.target.value || null })}>
                          <option value="">{t('app.noRole')}</option>
                          {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                        </select>
                      ) : (
                        <span className="status-pill">{user.role ? t('users.roleDetailsUnavailable') : t('app.noRole')}</span>
                      )}
                    </td>
                    <td>
                      <select aria-label={t('users.statusFor', { email: user.email })} value={user.status} disabled={user.id === currentUserId} onChange={(event) => updateUser(user, { status: event.target.value })}>
                        <option value="active">{t('users.active')}</option>
                        <option value="suspended">{t('users.suspended')}</option>
                        <option value="disabled">{t('users.disabled')}</option>
                      </select>
                    </td>
                    <td>
                      <span className={`status-pill verification-pill ${user.email_verified_at ? 'verified' : ''}`}>
                        {user.email_verified_at ? t('users.verified') : t('users.unverified')}
                      </span>
                    </td>
                    <td>{user.last_access ? new Date(user.last_access).toLocaleString(dateLocale) : t('users.never')}</td>
                    <td className="row-actions">
                      {!user.email_verified_at && (
                        <button className="text-button" type="button" onClick={() => sendVerification(user)}>{t('users.sendVerification')}</button>
                      )}
                      <button className="danger-button" type="button" disabled={user.id === currentUserId} onClick={() => deleteUser(user)}>{t('common.delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {loading ? (
            <div className="table-footer">{t('users.loading')}</div>
          ) : users.length === 0 ? (
            <div className="table-footer">{t('users.noneFound')}</div>
          ) : (
            <Pagination
              page={paged.page}
              pageSize={pageSize}
              totalItems={visibleUsers.length}
              pageSizeOptions={USER_PAGE_SIZES}
              itemLabel={t('users.users')}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          )}
        </section>
      )}
    </div>
  );
}
