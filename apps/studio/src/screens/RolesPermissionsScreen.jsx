import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import { useConfirmDialog } from '../components/DialogProvider.jsx';

const ACTIONS = ['read', 'create', 'update', 'delete'];
const ROLE_SORT_OPTIONS = [
  ['name-asc', 'Name A–Z'],
  ['name-desc', 'Name Z–A'],
  ['rules-desc', 'Most rules'],
];

function parseJsonInput(value) {
  if (!value.trim()) return null;
  return JSON.parse(value);
}

function supportsValidation(action) {
  return action === 'create' || action === 'update';
}

function permissionKey(role, collection, action) {
  return `${role}:${collection}:${action}`;
}

function prettyJson(value) {
  return value ? JSON.stringify(value, null, 2) : '';
}

export function RolesPermissionsScreen() {
  const requestConfirmation = useConfirmDialog();
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [collections, setCollections] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [roleSearch, setRoleSearch] = useState('');
  const [roleSort, setRoleSort] = useState('name-asc');
  const [collectionSearch, setCollectionSearch] = useState('');
  const [configuredOnly, setConfiguredOnly] = useState(false);
  const [roleForm, setRoleForm] = useState({ name: '', description: '', public: false });
  const [roleName, setRoleName] = useState('');
  const [advancedPermission, setAdvancedPermission] = useState(null);
  const [advancedFields, setAdvancedFields] = useState([]);
  const [advancedForm, setAdvancedForm] = useState({ allFields: true, fields: [], filter: '', validation: '' });
  const [busyKey, setBusyKey] = useState('');
  const [savingRole, setSavingRole] = useState(false);
  const [savingAdvanced, setSavingAdvanced] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  async function load(preferredRole = selectedRoleId) {
    setLoading(true);
    setError('');
    try {
      const [rolesResponse, permissionsResponse, collectionsResponse] = await Promise.all([
        apiRequest('/roles'),
        apiRequest('/permissions'),
        apiRequest('/schema/collections'),
      ]);
      const nextRoles = rolesResponse?.data ?? [];
      setRoles(nextRoles);
      setPermissions(permissionsResponse?.data ?? []);
      setCollections((collectionsResponse?.data ?? []).filter((entry) => !entry.system));
      setSelectedRoleId((current) => {
        const preferred = preferredRole || current;
        if (nextRoles.some((role) => role.id === preferred)) return preferred;
        return nextRoles.find((role) => !role.admin)?.id || nextRoles[0]?.id || '';
      });
    } catch (requestError) {
      setError(requestError.message || 'Roles and permissions could not be loaded');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const permissionIndex = useMemo(() => new Map(permissions.map((permission) => [
    permissionKey(permission.role, permission.collection, permission.action),
    permission,
  ])), [permissions]);
  const selectedRolePermissions = useMemo(() => permissions.filter((permission) =>
    permission.role === selectedRoleId), [permissions, selectedRoleId]);
  const roleRuleCounts = useMemo(() => {
    const counts = new Map();
    permissions.forEach((permission) => counts.set(permission.role, (counts.get(permission.role) || 0) + 1));
    return counts;
  }, [permissions]);
  const visibleRoles = useMemo(() => {
    const query = roleSearch.trim().toLowerCase();
    return roles
      .filter((role) => !query || [
        role.name,
        role.description,
        role.admin ? 'administrator' : null,
        role.public ? 'public' : 'custom',
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)))
      .slice()
      .sort((left, right) => {
        if (roleSort === 'rules-desc') {
          const countResult = (roleRuleCounts.get(right.id) || 0) - (roleRuleCounts.get(left.id) || 0);
          if (countResult) return countResult;
        }
        const nameResult = String(left.name || '').localeCompare(String(right.name || ''));
        return roleSort === 'name-desc' ? -nameResult : nameResult;
      });
  }, [roleRuleCounts, roleSearch, roleSort, roles]);
  const visibleCollections = useMemo(() => {
    const query = collectionSearch.trim().toLowerCase();
    return collections
      .filter((collection) => !query || [collection.collection, collection.note]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)))
      .filter((collection) => !configuredOnly || ACTIONS.some((action) =>
        permissionIndex.has(permissionKey(selectedRoleId, collection.collection, action))))
      .slice()
      .sort((left, right) => String(left.collection || '').localeCompare(String(right.collection || '')));
  }, [collectionSearch, collections, configuredOnly, permissionIndex, selectedRoleId]);

  useEffect(() => {
    setRoleName(selectedRole?.name || '');
    setAdvancedPermission(null);
  }, [selectedRole?.id, selectedRole?.name]);

  async function createRole(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const response = await apiRequest('/roles', {
        method: 'POST',
        body: {
          name: roleForm.name.trim(),
          description: roleForm.description.trim() || null,
          public: roleForm.public,
        },
      });
      const createdId = response?.data?.id || '';
      setRoleForm({ name: '', description: '', public: false });
      setShowCreateRole(false);
      setNotice('Role created');
      await load(createdId);
    } catch (requestError) {
      setError(requestError.message || 'Role could not be created');
    }
  }

  async function saveRoleName(event) {
    event.preventDefault();
    if (!selectedRole || !roleName.trim() || roleName.trim() === selectedRole.name) return;
    setSavingRole(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/roles/${encodeURIComponent(selectedRole.id)}`, {
        method: 'PATCH',
        body: { name: roleName.trim() },
      });
      setNotice('Role updated');
      await load(selectedRole.id);
    } catch (requestError) {
      setError(requestError.message || 'Role could not be updated');
    } finally {
      setSavingRole(false);
    }
  }

  async function deleteRole(role) {
    const accepted = await requestConfirmation({
      title: 'Delete role?',
      description: `${role.name} and all of its permission rules will be permanently deleted.`,
      confirmLabel: 'Delete role',
      tone: 'danger',
    });
    if (!accepted) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(`/roles/${encodeURIComponent(role.id)}`, { method: 'DELETE' });
      setNotice('Role deleted');
      setAdvancedPermission(null);
      await load('');
    } catch (requestError) {
      setError(requestError.message || 'Role could not be deleted');
    }
  }

  async function togglePermission(collection, action) {
    if (!selectedRole || selectedRole.admin) return;
    const key = permissionKey(selectedRole.id, collection, action);
    const existing = permissionIndex.get(key);
    setBusyKey(key);
    setError('');
    setNotice('');
    try {
      if (existing) {
        await apiRequest(`/permissions/${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
        if (advancedPermission?.id === existing.id) setAdvancedPermission(null);
        setNotice(`${action} access removed for ${collection}`);
      } else {
        await apiRequest('/permissions', {
          method: 'POST',
          body: {
            role: selectedRole.id,
            collection,
            action,
            fields: null,
            filter: null,
            validation: null,
          },
        });
        setNotice(`${action} access granted for ${collection}`);
      }
      await load(selectedRole.id);
    } catch (requestError) {
      setError(requestError.message || 'Permission could not be updated');
    } finally {
      setBusyKey('');
    }
  }

  async function openAdvanced(permission) {
    setError('');
    setNotice('');
    try {
      const fieldResponse = await apiRequest(`/schema/collections/${encodeURIComponent(permission.collection)}/fields`);
      setAdvancedFields((fieldResponse?.data ?? []).filter((field) => !field.hidden));
      setAdvancedPermission(permission);
      setAdvancedForm({
        allFields: !permission.fields || permission.fields.length === 0,
        fields: permission.fields || [],
        filter: prettyJson(permission.filter),
        validation: prettyJson(permission.validation),
      });
    } catch (requestError) {
      setError(requestError.message || 'Permission details could not be loaded');
    }
  }

  function toggleAdvancedField(fieldName) {
    setAdvancedForm((current) => ({
      ...current,
      fields: current.fields.includes(fieldName)
        ? current.fields.filter((field) => field !== fieldName)
        : [...current.fields, fieldName],
    }));
  }

  async function saveAdvancedPermission(event) {
    event.preventDefault();
    if (!advancedPermission) return;
    setSavingAdvanced(true);
    setError('');
    setNotice('');
    try {
      const filter = parseJsonInput(advancedForm.filter);
      const validation = supportsValidation(advancedPermission.action)
        ? parseJsonInput(advancedForm.validation)
        : null;
      if (!advancedForm.allFields && advancedForm.fields.length === 0) {
        throw new Error('Choose at least one allowed field or enable all fields.');
      }
      await apiRequest(`/permissions/${encodeURIComponent(advancedPermission.id)}`, {
        method: 'PATCH',
        body: {
          fields: advancedForm.allFields ? null : advancedForm.fields,
          filter,
          validation,
        },
      });
      setNotice('Advanced permission rules saved');
      setAdvancedPermission(null);
      await load(selectedRoleId);
    } catch (requestError) {
      setError(requestError instanceof SyntaxError
        ? 'Filter and validation rules must contain valid JSON.'
        : requestError.message || 'Permission could not be updated');
    } finally {
      setSavingAdvanced(false);
    }
  }

  return (
    <div className="screen-stack">
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      <section className="permissions-layout">
        <aside className="panel form-panel role-sidebar">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Access</p>
              <h2>Roles</h2>
              <p>Select a role, then grant collection actions from the matrix.</p>
            </div>
            <button className="primary-button" type="button" onClick={() => setShowCreateRole((value) => !value)}>
              {showCreateRole ? 'Cancel' : 'New role'}
            </button>
          </div>

          {showCreateRole && (
            <form className="schema-create-card form-stack compact" onSubmit={createRole}>
              <label className="field-label">
                <span>Name</span>
                <input
                  value={roleForm.name}
                  onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value }))}
                  required
                  autoFocus
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
          )}

          <div className="sidebar-filter-row">
            <label className="field-label">
              <span>Find role</span>
              <input
                type="search"
                value={roleSearch}
                onChange={(event) => setRoleSearch(event.target.value)}
                placeholder="Name or description…"
              />
            </label>
            <label className="field-label">
              <span>Sort</span>
              <select value={roleSort} onChange={(event) => setRoleSort(event.target.value)}>
                {ROLE_SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <small className="collection-group-label">Showing {visibleRoles.length}/{roles.length} roles</small>

          <div className="list-stack role-list">
            {visibleRoles.map((role) => (
              <button
                className={`list-button role-list-button ${role.id === selectedRoleId ? 'active' : ''}`}
                key={role.id}
                type="button"
                onClick={() => setSelectedRoleId(role.id)}
              >
                <span>
                  <strong>{role.name}</strong>
                  <small>{role.admin ? 'Administrator · full access' : role.public ? 'Public role' : role.description || 'Custom role'}</small>
                </span>
                {!role.admin && (
                  <span className="permission-count">{roleRuleCounts.get(role.id) || 0}</span>
                )}
              </button>
            ))}
            {roles.length > 0 && visibleRoles.length === 0 && <p className="muted-line">No matching roles.</p>}
          </div>
        </aside>

        <div className="permissions-detail-stack">
          {!selectedRole ? (
            <section className="panel empty-state"><div><h2>Select a role</h2><p>Choose a role to manage its access.</p></div></section>
          ) : (
            <>
              <section className="panel role-detail-header">
                <form className="role-name-form" onSubmit={saveRoleName}>
                  <div>
                    <p className="eyebrow">{selectedRole.admin ? 'Administrator role' : selectedRole.public ? 'Public role' : 'Custom role'}</p>
                    <label className="field-label role-name-field">
                      <span>Role name</span>
                      <input value={roleName} onChange={(event) => setRoleName(event.target.value)} required />
                    </label>
                  </div>
                  <button className="text-button" type="submit" disabled={savingRole || roleName.trim() === selectedRole.name}>
                    {savingRole ? 'Saving…' : 'Save name'}
                  </button>
                </form>
                {!selectedRole.admin && !selectedRole.public && (
                  <button className="danger-button" type="button" onClick={() => deleteRole(selectedRole)}>Delete role</button>
                )}
              </section>

              {selectedRole.admin ? (
                <section className="panel empty-state">
                  <div>
                    <h2>Full administrator access</h2>
                    <p>This role bypasses collection permission rows. No matrix configuration is required.</p>
                  </div>
                </section>
              ) : (
                <section className="table-panel permission-matrix-panel">
                  <div className="permission-matrix-heading">
                    <div>
                      <p className="eyebrow">Permissions</p>
                      <h2>Collection access</h2>
                      <p>Turn actions on for simple full-field access. Use Configure only when field or row-level rules are needed.</p>
                    </div>
                    <span className="schema-count">{selectedRolePermissions.length} rules</span>
                  </div>
                  <div className="permission-list-controls">
                    <label className="field-label">
                      <span>Find collection</span>
                      <input
                        type="search"
                        value={collectionSearch}
                        onChange={(event) => setCollectionSearch(event.target.value)}
                        placeholder="Name or description…"
                      />
                    </label>
                    <label className="checkbox-label permission-filter-checkbox">
                      <input
                        type="checkbox"
                        checked={configuredOnly}
                        onChange={(event) => setConfiguredOnly(event.target.checked)}
                      />
                      Configured only
                    </label>
                    <span className="result-count">{visibleCollections.length}/{collections.length} collections</span>
                    {(collectionSearch || configuredOnly) && (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => { setCollectionSearch(''); setConfiguredOnly(false); }}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <div className="table-scroll">
                    <table className="permission-matrix">
                      <thead>
                        <tr>
                          <th>Collection</th>
                          {ACTIONS.map((action) => <th key={action}>{action}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleCollections.map((collection) => (
                          <tr key={collection.collection}>
                            <td>
                              <strong>{collection.collection}</strong>
                              {collection.note && <small className="matrix-note">{collection.note}</small>}
                            </td>
                            {ACTIONS.map((action) => {
                              const key = permissionKey(selectedRole.id, collection.collection, action);
                              const permission = permissionIndex.get(key);
                              const advanced = permission && (
                                (permission.fields && permission.fields.length > 0) ||
                                permission.filter ||
                                permission.validation
                              );
                              return (
                                <td key={action}>
                                  <div className="permission-cell">
                                    <label className="permission-toggle">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(permission)}
                                        disabled={busyKey === key}
                                        onChange={() => togglePermission(collection.collection, action)}
                                        aria-label={`${action} ${collection.collection}`}
                                      />
                                      <span>{permission ? 'Allowed' : 'Off'}</span>
                                    </label>
                                    {permission && (
                                      <button className="text-button permission-configure" type="button" onClick={() => openAdvanced(permission)}>
                                        {advanced ? 'Configured' : 'Configure'}
                                      </button>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!loading && collections.length === 0 && <div className="table-footer">Create a collection before configuring permissions.</div>}
                  {!loading && collections.length > 0 && visibleCollections.length === 0 && (
                    <div className="table-footer">No collections match the current permission filters.</div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </section>

      {advancedPermission && (
        <form className="panel form-panel advanced-permission-panel" onSubmit={saveAdvancedPermission}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Advanced access</p>
              <h2>{advancedPermission.collection} · {advancedPermission.action}</h2>
              <p>Limit visible/writable fields or add row-level rules. Empty JSON rules mean no extra restriction.</p>
            </div>
            <button className="text-button" type="button" onClick={() => setAdvancedPermission(null)}>Close</button>
          </div>

          <div className="advanced-permission-grid">
            <div className="schema-create-card form-stack">
              <div>
                <strong>Allowed fields</strong>
                <p>All fields is the simple default. Turn it off to explicitly choose fields.</p>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={advancedForm.allFields}
                  onChange={(event) => setAdvancedForm((current) => ({ ...current, allFields: event.target.checked }))}
                />
                Allow all fields
              </label>
              {!advancedForm.allFields && (
                <div className="field-choice-grid">
                  {advancedFields.map((field) => (
                    <label className="field-choice" key={field.field}>
                      <input
                        type="checkbox"
                        checked={advancedForm.fields.includes(field.field)}
                        onChange={() => toggleAdvancedField(field.field)}
                      />
                      <span><strong>{field.field}</strong><small>{field.type}</small></span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="schema-create-card form-stack">
              <label className="field-label">
                <span>Row filter JSON</span>
                <small>Only rows matching this rule are accessible for this action.</small>
                <textarea
                  rows="8"
                  value={advancedForm.filter}
                  onChange={(event) => setAdvancedForm((current) => ({ ...current, filter: event.target.value }))}
                  placeholder='{"status":{"_eq":"active"}}'
                />
              </label>
              <label className="field-label">
                <span>Write validation JSON</span>
                <small>{supportsValidation(advancedPermission.action)
                  ? 'For create/update, the final record must match this rule.'
                  : 'Validation applies only to create and update permissions.'}</small>
                <textarea
                  rows="8"
                  value={advancedForm.validation}
                  disabled={!supportsValidation(advancedPermission.action)}
                  onChange={(event) => setAdvancedForm((current) => ({ ...current, validation: event.target.value }))}
                  placeholder='{"status":{"_in":["draft","active"]}}'
                />
              </label>
            </div>
          </div>

          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={savingAdvanced}>{savingAdvanced ? 'Saving…' : 'Save advanced rules'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
