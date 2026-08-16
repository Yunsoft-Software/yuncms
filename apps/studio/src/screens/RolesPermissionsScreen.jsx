import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';

function parseFilterInput(value) {
  if (!value.trim()) return null;
  return JSON.parse(value);
}

function normalizeFieldsInput(value) {
  const fields = value.split(',').map((field) => field.trim()).filter(Boolean);
  return fields.length > 0 ? fields : null;
}

export function RolesPermissionsScreen() {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [collections, setCollections] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const [roleForm, setRoleForm] = useState({ name: '', description: '', public: false });
  const [permissionForm, setPermissionForm] = useState({
    role: '', collection: '', action: 'read', fields: '', filter: '',
  });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [rolesResponse, permissionsResponse, collectionsResponse] = await Promise.all([
        apiRequest('/roles'),
        apiRequest('/permissions'),
        apiRequest('/schema/collections'),
      ]);
      setRoles(rolesResponse?.data ?? []);
      setPermissions(permissionsResponse?.data ?? []);
      setCollections((collectionsResponse?.data ?? []).filter((entry) => !entry.system));
    } catch (requestError) {
      setError(requestError.message || 'Roles and permissions could not be loaded');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const roleNames = useMemo(() => new Map(roles.map((role) => [role.id, role.name])), [roles]);

  async function createRole(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await apiRequest('/roles', {
        method: 'POST',
        body: {
          name: roleForm.name,
          description: roleForm.description || null,
          public: roleForm.public,
        },
      });
      setRoleForm({ name: '', description: '', public: false });
      setNotice('Role created');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Role could not be created');
    }
  }

  async function renameRole(role) {
    const name = window.prompt('Role name', role.name);
    if (!name || name === role.name) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(`/roles/${encodeURIComponent(role.id)}`, {
        method: 'PATCH',
        body: { name },
      });
      setNotice('Role updated');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Role could not be updated');
    }
  }

  async function deleteRole(role) {
    if (!window.confirm(`Delete role ${role.name}?`)) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(`/roles/${encodeURIComponent(role.id)}`, { method: 'DELETE' });
      setNotice('Role deleted');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Role could not be deleted');
    }
  }

  async function createPermission(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const fields = normalizeFieldsInput(permissionForm.fields);
      const filter = parseFilterInput(permissionForm.filter);
      await apiRequest('/permissions', {
        method: 'POST',
        body: {
          role: permissionForm.role,
          collection: permissionForm.collection,
          action: permissionForm.action,
          fields,
          filter,
        },
      });
      setPermissionForm((current) => ({
        ...current,
        action: 'read',
        fields: '',
        filter: '',
      }));
      setNotice('Permission created');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Permission could not be created');
    }
  }

  async function editPermission(permission) {
    const currentFields = permission.fields?.join(', ') ?? '';
    const fields = window.prompt('Allowed fields (comma separated, empty = all)', currentFields);
    if (fields == null) return;
    const currentFilter = permission.filter ? JSON.stringify(permission.filter) : '';
    const filter = window.prompt('Row filter JSON (empty = none)', currentFilter);
    if (filter == null) return;

    setError('');
    setNotice('');
    try {
      await apiRequest(`/permissions/${encodeURIComponent(permission.id)}`, {
        method: 'PATCH',
        body: {
          fields: normalizeFieldsInput(fields),
          filter: parseFilterInput(filter),
        },
      });
      setNotice('Permission updated');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Permission could not be updated');
    }
  }

  async function deletePermission(permission) {
    if (!window.confirm(`Delete ${permission.action} permission for ${permission.collection}?`)) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(`/permissions/${encodeURIComponent(permission.id)}`, { method: 'DELETE' });
      setNotice('Permission deleted');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Permission could not be deleted');
    }
  }

  return (
    <div className="screen-stack">
      <section className="split-grid">
        <article className="panel form-panel">
          <div>
            <p className="eyebrow">Roles</p>
            <h2>Role management</h2>
            <p>Administrator/public flags are protected after creation; normal role metadata stays editable.</p>
          </div>

          <form className="form-stack compact" onSubmit={createRole}>
            <label className="field-label">
              <span>Name</span>
              <input
                value={roleForm.name}
                onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </label>
            <label className="field-label">
              <span>Description</span>
              <input
                value={roleForm.description}
                onChange={(event) => setRoleForm((current) => ({ ...current, description: event.target.value }))}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={roleForm.public}
                onChange={(event) => setRoleForm((current) => ({ ...current, public: event.target.checked }))}
              />
              Public role
            </label>
            <button className="primary-button" type="submit">Create role</button>
          </form>

          <div className="list-stack">
            {roles.map((role) => (
              <div className="relation-row" key={role.id}>
                <div>
                  <strong>{role.name}</strong>
                  <small>{role.admin ? 'administrator' : role.public ? 'public' : 'custom role'}</small>
                </div>
                <div className="row-actions">
                  <button className="text-button" type="button" onClick={() => renameRole(role)}>Rename</button>
                  {!role.admin && !role.public && (
                    <button className="danger-button" type="button" onClick={() => deleteRole(role)}>Delete</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel form-panel">
          <div>
            <p className="eyebrow">Permissions</p>
            <h2>Create permission</h2>
            <p>Fields and row filters are enforced by ItemsService, including extension calls.</p>
          </div>

          <form className="form-stack compact" onSubmit={createPermission}>
            <label className="field-label">
              <span>Role</span>
              <select
                value={permissionForm.role}
                onChange={(event) => setPermissionForm((current) => ({ ...current, role: event.target.value }))}
                required
              >
                <option value="">Select role</option>
                {roles.filter((role) => !role.admin).map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>Collection</span>
              <select
                value={permissionForm.collection}
                onChange={(event) => setPermissionForm((current) => ({ ...current, collection: event.target.value }))}
                required
              >
                <option value="">Select collection</option>
                {collections.map((entry) => (
                  <option key={entry.collection} value={entry.collection}>{entry.collection}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>Action</span>
              <select
                value={permissionForm.action}
                onChange={(event) => setPermissionForm((current) => ({ ...current, action: event.target.value }))}
              >
                <option value="read">read</option>
                <option value="create">create</option>
                <option value="update">update</option>
                <option value="delete">delete</option>
              </select>
            </label>
            <label className="field-label">
              <span>Allowed fields</span>
              <input
                value={permissionForm.fields}
                onChange={(event) => setPermissionForm((current) => ({ ...current, fields: event.target.value }))}
                placeholder="id, title, status (empty = all)"
              />
            </label>
            <label className="field-label">
              <span>Row filter JSON</span>
              <textarea
                rows="4"
                value={permissionForm.filter}
                onChange={(event) => setPermissionForm((current) => ({ ...current, filter: event.target.value }))}
                placeholder='{"status":{"_eq":"active"}}'
              />
            </label>
            <button className="primary-button" type="submit">Create permission</button>
          </form>
        </article>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      <section className="table-panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Role</th><th>Collection</th><th>Action</th><th>Fields</th><th>Filter</th><th /></tr></thead>
            <tbody>
              {permissions.map((permission) => (
                <tr key={permission.id}>
                  <td>{roleNames.get(permission.role) || permission.role}</td>
                  <td>{permission.collection}</td>
                  <td>{permission.action}</td>
                  <td>{permission.fields?.join(', ') || 'all'}</td>
                  <td><code>{permission.filter ? JSON.stringify(permission.filter) : '—'}</code></td>
                  <td className="row-actions">
                    <button className="text-button" type="button" onClick={() => editPermission(permission)}>Edit</button>
                    <button className="danger-button" type="button" onClick={() => deletePermission(permission)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <div className="table-footer">Loading permissions…</div>}
        {!loading && permissions.length === 0 && <div className="table-footer">No permissions configured.</div>}
      </section>
    </div>
  );
}
