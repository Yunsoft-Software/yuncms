import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import { Pagination, RuleBuilder, paginateClientItems, useConfirmDialog } from '../components/index.js';
import { useI18n } from '../i18n.js';
import { studioPath } from '../studio-route.js';
import {
  canConfigurePermission,
  canUseAdvancedPermission,
  isPermissionCollection,
  permissionResourcePolicy,
} from '../permission-resource-ui.js';

const ACTIONS = ['read', 'create', 'update', 'delete'];
const ROLE_SORT_OPTIONS = [
  ['name-asc', 'roles.nameAsc'],
  ['name-desc', 'roles.nameDesc'],
  ['rules-desc', 'roles.mostRules'],
];
const ROLE_PAGE_SIZES = [6, 12, 24];
const COLLECTION_PAGE_SIZES = [10, 20, 50];

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

function actionLabel(action, t) {
  return t(`roles.${action}`);
}

function roleKindLabel(role, t) {
  if (role?.admin) return t('roles.administrator');
  if (role?.public) return t('roles.public');
  return t('roles.custom');
}

function isRestricted(permission) {
  return Boolean(permission && (
    (permission.fields && permission.fields.length > 0)
    || permission.filter
    || permission.validation
  ));
}

function ruleBuilderLabels(t, title, description) {
  return {
    title,
    description,
    rawMode: t('roles.advancedJson'),
    visualMode: t('roles.visualRules'),
    complexJson: t('roles.complexRuleNotice'),
    invalidJson: t('roles.invalidRuleJson'),
    addRule: t('roles.addRule'),
    removeRule: t('roles.removeRule'),
    empty: t('roles.noRestrictions'),
    field: t('roles.ruleField'),
    operator: t('roles.ruleCondition'),
    value: t('roles.ruleValue'),
    noValue: t('roles.ruleNoValue'),
    rawLabel: t('roles.advancedJson'),
    trueLabel: t('common.yes'),
    falseLabel: t('common.no'),
    operators: {
      _eq: t('content.opEquals'),
      _neq: t('content.opDoesNotEqual'),
      _contains: t('content.opContains'),
      _starts_with: t('content.opStartsWith'),
      _ends_with: t('content.opEndsWith'),
      _gt: t('content.opGreaterThan'),
      _gte: t('content.opGreaterEqual'),
      _lt: t('content.opLessThan'),
      _lte: t('content.opLessEqual'),
      _null: t('content.opEmpty'),
      _nnull: t('content.opNotEmpty'),
    },
  };
}

export function RolesPermissionsScreen({ route = {}, onNavigate }) {
  const { t } = useI18n();
  const requestConfirmation = useConfirmDialog();
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [collections, setCollections] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [roleSearch, setRoleSearch] = useState('');
  const [roleSort, setRoleSort] = useState('name-asc');
  const [rolePage, setRolePage] = useState(1);
  const [rolePageSize, setRolePageSize] = useState(12);
  const [collectionSearch, setCollectionSearch] = useState('');
  const [configuredOnly, setConfiguredOnly] = useState(false);
  const [collectionPage, setCollectionPage] = useState(1);
  const [collectionPageSize, setCollectionPageSize] = useState(20);
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
      setCollections((collectionsResponse?.data ?? []).filter(isPermissionCollection));
      setSelectedRoleId((current) => {
        const preferred = preferredRole || current;
        if (nextRoles.some((role) => role.id === preferred)) return preferred;
        return '';
      });
      if (preferredRole && !nextRoles.some((role) => role.id === preferredRole)) onNavigate?.(studioPath.roles());
    } catch (requestError) {
      setError(requestError.message || t('roles.loadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setSelectedRoleId(route.roleId || '');
    setShowCreateRole(route.view === 'new');
  }, [route.roleId, route.view]);

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const permissionIndex = useMemo(() => new Map(permissions.map((permission) => [
    permissionKey(permission.role, permission.collection, permission.action),
    permission,
  ])), [permissions]);
  const selectedRolePermissions = useMemo(() => permissions.filter((permission) =>
    permission.role === selectedRoleId), [permissions, selectedRoleId]);
  const permissionCollection = collections.find((entry) => entry.collection === route.collection) ?? null;
  const routedPermission = route.view === 'permission'
    ? permissionIndex.get(permissionKey(route.roleId, route.collection, route.action)) ?? null
    : null;
  const restrictedRuleCount = useMemo(
    () => selectedRolePermissions.filter(isRestricted).length,
    [selectedRolePermissions],
  );
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
        roleKindLabel(role, t),
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
  }, [roleRuleCounts, roleSearch, roleSort, roles, t]);
  const visibleCollections = useMemo(() => {
    const query = collectionSearch.trim().toLowerCase();
    return collections
      .filter((collection) => !query || [
        collection.collection,
        collection.note,
        collection.system ? t('roles.systemResource') : '',
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)))
      .filter((collection) => !configuredOnly || ACTIONS.some((action) =>
        permissionIndex.has(permissionKey(selectedRoleId, collection.collection, action))))
      .slice()
      .sort((left, right) => {
        const systemResult = Number(Boolean(left.system)) - Number(Boolean(right.system));
        if (systemResult) return systemResult;
        return String(left.collection || '').localeCompare(String(right.collection || ''));
      });
  }, [collectionSearch, collections, configuredOnly, permissionIndex, selectedRoleId, t]);

  const pagedRoles = useMemo(() => paginateClientItems(visibleRoles, rolePage, rolePageSize), [rolePage, rolePageSize, visibleRoles]);
  const pagedCollections = useMemo(() => paginateClientItems(visibleCollections, collectionPage, collectionPageSize), [collectionPage, collectionPageSize, visibleCollections]);

  useEffect(() => setRolePage(1), [roleSearch, roleSort]);
  useEffect(() => setCollectionPage(1), [collectionSearch, configuredOnly, selectedRoleId]);
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
      setRolePage(1);
      setNotice(t('roles.createdNotice'));
      await load(createdId);
      onNavigate?.(studioPath.role(createdId));
    } catch (requestError) {
      setError(requestError.message || t('roles.createError'));
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
      setNotice(t('roles.updatedNotice'));
      await load(selectedRole.id);
    } catch (requestError) {
      setError(requestError.message || t('roles.updateError'));
    } finally {
      setSavingRole(false);
    }
  }

  async function deleteRole(role) {
    const accepted = await requestConfirmation({
      title: t('roles.deleteTitle'),
      description: t('roles.deleteDescription', { name: role.name }),
      confirmLabel: t('roles.deleteRole'),
      tone: 'danger',
    });
    if (!accepted) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(`/roles/${encodeURIComponent(role.id)}`, { method: 'DELETE' });
      setNotice(t('roles.deletedNotice'));
      setAdvancedPermission(null);
      await load('');
      onNavigate?.(studioPath.roles());
    } catch (requestError) {
      setError(requestError.message || t('roles.deleteError'));
    }
  }

  async function togglePermission(collection, action) {
    if (!selectedRole || selectedRole.admin || !canConfigurePermission(collection, action, selectedRole)) return;
    const collectionName = collection.collection;
    const key = permissionKey(selectedRole.id, collectionName, action);
    const existing = permissionIndex.get(key);
    setBusyKey(key);
    setError('');
    setNotice('');
    try {
      if (existing) {
        await apiRequest(`/permissions/${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
        if (advancedPermission?.id === existing.id) setAdvancedPermission(null);
        setNotice(t('roles.accessRemoved', { action: actionLabel(action, t), collection: collectionName }));
      } else {
        await apiRequest('/permissions', {
          method: 'POST',
          body: {
            role: selectedRole.id,
            collection: collectionName,
            action,
            fields: null,
            filter: null,
            validation: null,
          },
        });
        setNotice(t('roles.accessGranted', { action: actionLabel(action, t), collection: collectionName }));
      }
      await load(selectedRole.id);
    } catch (requestError) {
      setError(requestError.message || t('roles.permissionUpdateError'));
    } finally {
      setBusyKey('');
    }
  }

  async function loadPermissionEditor(permission) {
    const collection = collections.find((entry) => entry.collection === permission.collection);
    if (!collection) return;
    setError('');
    setNotice('');
    try {
      const fieldResponse = canUseAdvancedPermission(collection)
        ? await apiRequest(`/schema/collections/${encodeURIComponent(permission.collection)}/fields`)
        : { data: [] };
      setAdvancedFields((fieldResponse?.data ?? []).filter((field) => !field.hidden));
      setAdvancedPermission(permission);
      setAdvancedForm({
        allFields: !permission.fields || permission.fields.length === 0,
        fields: permission.fields || [],
        filter: prettyJson(permission.filter),
        validation: prettyJson(permission.validation),
      });
    } catch (requestError) {
      setError(requestError.message || t('roles.permissionDetailsError'));
    }
  }

  function openPermissionPage(collection, action) {
    if (!selectedRole) return;
    onNavigate?.(studioPath.permission(selectedRole.id, collection.collection, action));
  }

  useEffect(() => {
    if (route.view !== 'permission' || !route.roleId || !route.collection || !route.action || loading) return;
    const permission = permissionIndex.get(permissionKey(route.roleId, route.collection, route.action));
    loadPermissionEditor(permission || {
      id: null,
      role: route.roleId,
      collection: route.collection,
      action: route.action,
      fields: null,
      filter: null,
      validation: null,
    });
  }, [loading, permissionIndex, route.action, route.collection, route.roleId, route.view]);

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
        throw new Error(t('roles.chooseFieldError'));
      }
      await apiRequest(`/permissions/${encodeURIComponent(advancedPermission.id)}`, {
        method: 'PATCH',
        body: {
          fields: advancedForm.allFields ? null : advancedForm.fields,
          filter,
          validation,
        },
      });
      setNotice(t('roles.advancedSaved'));
      await load(selectedRoleId);
    } catch (requestError) {
      setError(requestError instanceof SyntaxError
        ? t('roles.invalidJson')
        : requestError.message || t('roles.permissionUpdateError'));
    } finally {
      setSavingAdvanced(false);
    }
  }

  return (
    <div className="screen-stack">
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      <section className={`permissions-layout routed-view-${route.view || 'list'}`}>
        <aside className="panel form-panel role-sidebar access-role-sidebar">
          <div className="panel-heading role-sidebar-heading">
            <div>
              <p className="eyebrow">{t('roles.access')}</p>
              <h2>{t('roles.roles')}</h2>
              <p>{t('roles.summary', { count: roles.length })}</p>
            </div>
            <button className="primary-button" type="button" onClick={() => onNavigate?.(showCreateRole ? studioPath.roles() : studioPath.newRole())}>
              {showCreateRole ? t('common.cancel') : t('common.create')}
            </button>
          </div>

          {showCreateRole && (
            <form className="schema-create-card form-stack compact" onSubmit={createRole}>
              <label className="field-label"><span>{t('common.name')}</span><input value={roleForm.name} onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value }))} required autoFocus /></label>
              <label className="field-label"><span>{t('dataModel.description')}</span><input value={roleForm.description} onChange={(event) => setRoleForm((current) => ({ ...current, description: event.target.value }))} /></label>
              <label className="checkbox-label"><input type="checkbox" checked={roleForm.public} onChange={(event) => setRoleForm((current) => ({ ...current, public: event.target.checked }))} />{t('roles.publicRole')}</label>
              {roleForm.public && <div className="inline-info public-role-create-hint">{t('roles.publicAccessDescription')}</div>}
              <button className="primary-button" type="submit">{t('roles.createRole')}</button>
            </form>
          )}

          <div className="sidebar-filter-row">
            <label className="field-label"><span>{t('roles.findRole')}</span><input type="search" value={roleSearch} onChange={(event) => setRoleSearch(event.target.value)} placeholder={t('visibility.searchPlaceholder')} /></label>
            <label className="field-label"><span>{t('common.sort')}</span><select value={roleSort} onChange={(event) => setRoleSort(event.target.value)}>{ROLE_SORT_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}</select></label>
          </div>

          <div className="list-stack role-list role-list-page">
            {pagedRoles.items.map((role) => (
              <button className={`list-button role-list-button ${role.id === selectedRoleId ? 'active' : ''}`} key={role.id} type="button" onClick={() => onNavigate?.(studioPath.role(role.id))}>
                <span>
                  <strong>{role.name}</strong>
                  <small>{role.admin ? t('roles.adminFullAccess') : role.public ? t('roles.publicRole') : role.description || t('roles.customRole')}</small>
                </span>
                {!role.admin && <span className="permission-count">{roleRuleCounts.get(role.id) || 0}</span>}
              </button>
            ))}
            {roles.length > 0 && visibleRoles.length === 0 && <p className="muted-line">{t('roles.noRoles')}</p>}
          </div>
          {visibleRoles.length > 0 && (
            <Pagination compact page={pagedRoles.page} pageSize={rolePageSize} totalItems={visibleRoles.length} pageSizeOptions={ROLE_PAGE_SIZES} itemLabel={t('roles.rolesLower')} onPageChange={setRolePage} onPageSizeChange={(size) => { setRolePageSize(size); setRolePage(1); }} />
          )}
        </aside>

        <div className="permissions-detail-stack">
          {selectedRole && <nav className="page-breadcrumbs" aria-label={t('roles.roles')}><button type="button" onClick={() => onNavigate?.(studioPath.roles())}>{t('roles.roles')}</button><span aria-hidden="true">/</span><strong>{selectedRole.name}</strong>{route.view === 'permission' && <><span aria-hidden="true">/</span><button type="button" onClick={() => onNavigate?.(studioPath.role(selectedRole.id))}>{t('roles.permissions')}</button><span aria-hidden="true">/</span><strong>{route.collection} · {actionLabel(route.action, t)}</strong></>}</nav>}
          {!selectedRole ? (
            <section className="panel empty-state"><div><h2>{t('roles.selectRole')}</h2><p>{t('roles.selectRoleDescription')}</p></div></section>
          ) : (
            <>
              {route.view !== 'permission' && <>
              <section className="panel role-detail-header role-summary-panel">
                <form className="role-name-form" onSubmit={saveRoleName}>
                  <div>
                    <div className="role-heading-line">
                      <span className={`status-pill role-kind-badge ${selectedRole.public ? 'public' : selectedRole.admin ? 'admin' : 'custom'}`}>
                        {roleKindLabel(selectedRole, t)}
                      </span>
                    </div>
                    <label className="field-label role-name-field"><span>{t('roles.roleName')}</span><input value={roleName} onChange={(event) => setRoleName(event.target.value)} required /></label>
                  </div>
                  <button className="text-button" type="submit" disabled={savingRole || roleName.trim() === selectedRole.name}>{savingRole ? t('common.saving') : t('roles.saveName')}</button>
                </form>
                <div className="role-summary-actions">
                  <span className="role-summary-stat"><strong>{selectedRolePermissions.length}</strong><small>{t('roles.permissionRules')}</small></span>
                  {!selectedRole.admin && !selectedRole.public && <button className="danger-button" type="button" onClick={() => deleteRole(selectedRole)}>{t('roles.deleteRole')}</button>}
                </div>
              </section>

              {Boolean(selectedRole.public) && (
                <section className="panel public-role-guidance" role="note">
                  <div>
                    <p className="eyebrow">{t('roles.publicAccessTitle')}</p>
                    <strong>{t('roles.publicAccessTitle')}</strong>
                    <p>{t('roles.publicAccessDescription')}</p>
                  </div>
                </section>
              )}

              {!selectedRole.admin && (
                <section className="panel permission-overview-panel">
                  <div>
                    <p className="eyebrow">{t('roles.accessOverview')}</p>
                    <p>{t('roles.quickAuditHint')}</p>
                  </div>
                  <div className="permission-overview-stats">
                    <span><strong>{selectedRolePermissions.length}</strong><small>{t('roles.enabledActions', { count: selectedRolePermissions.length })}</small></span>
                    <span><strong>{restrictedRuleCount}</strong><small>{t('roles.restrictedActions', { count: restrictedRuleCount })}</small></span>
                  </div>
                </section>
              )}

              {selectedRole.admin ? (
                <section className="panel empty-state"><div><h2>{t('roles.fullAdmin')}</h2><p>{t('roles.fullAdminDescription')}</p></div></section>
              ) : (
                <section className="table-panel permission-matrix-panel">
                  <div className="permission-matrix-heading">
                    <div><p className="eyebrow">{t('roles.permissions')}</p><h2>{t('roles.collectionAccess')}</h2><p>{t('roles.systemAccessHint')}</p></div>
                    <span className="schema-count">{t('roles.ruleCount', { count: selectedRolePermissions.length })}</span>
                  </div>
                  <div className="permission-list-controls">
                    <label className="field-label"><span>{t('dataModel.findCollection')}</span><input type="search" value={collectionSearch} onChange={(event) => setCollectionSearch(event.target.value)} placeholder={t('visibility.searchPlaceholder')} /></label>
                    <label className="checkbox-label permission-filter-checkbox"><input type="checkbox" checked={configuredOnly} onChange={(event) => setConfiguredOnly(event.target.checked)} />{t('roles.configuredOnly')}</label>
                    <span className="result-count">{t('roles.collectionCount', { visible: visibleCollections.length, total: collections.length })}</span>
                    {(collectionSearch || configuredOnly) && <button className="text-button" type="button" onClick={() => { setCollectionSearch(''); setConfiguredOnly(false); }}>{t('common.reset')}</button>}
                  </div>
                  <div className="permission-collection-grid">
                    {pagedCollections.items.map((collection) => {
                      const policy = permissionResourcePolicy(collection);
                      return (
                        <article className="permission-collection-card" key={collection.collection}>
                          <header>
                            <div className="permission-collection-name"><strong>{collection.collection}</strong>{policy.systemManaged && <span className="status-pill system-resource-pill">{t('roles.systemResource')}</span>}</div>
                            <small>{collection.note || t('roles.collectionPermissionHint')}</small>
                          </header>
                          <div className="permission-action-list">
                            {ACTIONS.map((action) => {
                              const key = permissionKey(selectedRole.id, collection.collection, action);
                              const permission = permissionIndex.get(key);
                              const allowed = canConfigurePermission(collection, action, selectedRole);
                              const advanced = isRestricted(permission);
                              return (
                                <div className="permission-action-row" key={action}>
                                  <div><strong>{actionLabel(action, t)}</strong><small>{permission ? (advanced ? t('roles.restricted') : t('roles.allRecords')) : t('roles.permissionDisabled')}</small></div>
                                  {allowed ? (
                                    <div className="permission-action-controls">
                                      <label className={`permission-toggle ${permission ? 'enabled' : ''}`}><input type="checkbox" checked={Boolean(permission)} disabled={busyKey === key} onChange={() => togglePermission(collection, action)} aria-label={t('roles.actionCollection', { action: actionLabel(action, t), collection: collection.collection })} /><span>{permission ? t('roles.allowed') : t('roles.off')}</span></label>
                                      <button className="secondary-button permission-configure" type="button" onClick={() => openPermissionPage(collection, action)}>{t('roles.openPermission')}</button>
                                    </div>
                                  ) : <span className="status-pill protected-permission">{t('roles.protected')}</span>}
                                </div>
                              );
                            })}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {!loading && collections.length === 0 ? (
                    <div className="table-footer">{t('roles.createCollectionFirst')}</div>
                  ) : !loading && visibleCollections.length === 0 ? (
                    <div className="table-footer">{t('roles.noMatchingCollections')}</div>
                  ) : (
                    <Pagination page={pagedCollections.page} pageSize={collectionPageSize} totalItems={visibleCollections.length} pageSizeOptions={COLLECTION_PAGE_SIZES} itemLabel={t('dataModel.collectionsLower')} onPageChange={setCollectionPage} onPageSizeChange={(size) => { setCollectionPageSize(size); setCollectionPage(1); }} />
                  )}
                </section>
              )}
              </>}

              {route.view === 'permission' && (
                <section className="panel permission-detail-page">
                  {!permissionCollection ? (
                    <div className="empty-state"><div><h2>{t('roles.permissionNotFound')}</h2><p>{t('roles.permissionNotFoundDescription')}</p></div><button className="primary-button" type="button" onClick={() => onNavigate?.(studioPath.role(selectedRole.id))}>{t('roles.backToRole')}</button></div>
                  ) : (
                    <>
                      <header className="permission-detail-heading">
                        <div><p className="eyebrow">{t('roles.permissionDetail')}</p><h2>{permissionCollection.collection} · {actionLabel(route.action, t)}</h2><p>{permissionCollection.note || t('roles.permissionDetailDescription')}</p></div>
                        <span className={`permission-state-badge ${routedPermission ? 'enabled' : 'disabled'}`}>{routedPermission ? t('roles.permissionEnabled') : t('roles.permissionDisabled')}</span>
                      </header>

                      {!canConfigurePermission(permissionCollection, route.action, selectedRole) ? (
                        <div className="inline-info">{t('roles.protected')}</div>
                      ) : (
                        <>
                          <div className="permission-master-switch">
                            <div><strong>{t('roles.permissionMasterSwitch')}</strong><p>{t('roles.permissionMasterSwitchHint')}</p></div>
                            <label className={`permission-toggle ${routedPermission ? 'enabled' : ''}`}><input type="checkbox" checked={Boolean(routedPermission)} disabled={busyKey === permissionKey(selectedRole.id, permissionCollection.collection, route.action)} onChange={() => togglePermission(permissionCollection, route.action)} /><span>{routedPermission ? t('roles.allowed') : t('roles.off')}</span></label>
                          </div>

                          {!routedPermission ? (
                            <div className="empty-state permission-disabled-state"><div><h3>{t('roles.permissionDisabled')}</h3><p>{t('roles.enableBeforeRules')}</p></div></div>
                          ) : canUseAdvancedPermission(permissionCollection) && advancedPermission?.id === routedPermission.id ? (
                            <form id="advanced-permission-form" className="advanced-permission-grid permission-rule-page" onSubmit={saveAdvancedPermission}>
                              <div className="schema-create-card form-stack">
                                <div><strong>{t('roles.allowedFields')}</strong><p>{t('roles.allowedFieldsDescription')}</p></div>
                                <label className="checkbox-label"><input type="checkbox" checked={advancedForm.allFields} onChange={(event) => setAdvancedForm((current) => ({ ...current, allFields: event.target.checked }))} />{t('roles.allowAllFields')}</label>
                                {!advancedForm.allFields && <div className="field-choice-grid">{advancedFields.map((field) => <label className="field-choice" key={field.field}><input type="checkbox" checked={advancedForm.fields.includes(field.field)} onChange={() => toggleAdvancedField(field.field)} /><span><strong>{field.name || field.field}</strong><small>{field.field} · {field.type}</small></span></label>)}</div>}
                              </div>
                              <div className="schema-create-card form-stack">
                                <div className="permission-rule-builder-stack">
                                  <div className="permission-rule-builder-card">
                                    <RuleBuilder
                                      value={advancedForm.filter}
                                      fields={advancedFields}
                                      onChange={(filter) => setAdvancedForm((current) => ({ ...current, filter }))}
                                      labels={ruleBuilderLabels(t, t('roles.rowFilter'), t('roles.visualRuleDescription'))}
                                    />
                                  </div>
                                  <div className="permission-rule-builder-card">
                                    <RuleBuilder
                                      value={advancedForm.validation}
                                      fields={advancedFields}
                                      disabled={!supportsValidation(route.action)}
                                      onChange={(validation) => setAdvancedForm((current) => ({ ...current, validation }))}
                                      labels={ruleBuilderLabels(
                                        t,
                                        t('roles.validation'),
                                        supportsValidation(route.action) ? t('roles.validationWriteDescription') : t('roles.validationUnsupported'),
                                      )}
                                    />
                                  </div>
                                </div>
                                <div className="form-actions"><button className="primary-button" type="submit" disabled={savingAdvanced}>{savingAdvanced ? t('common.saving') : t('roles.saveRules')}</button></div>
                              </div>
                            </form>
                          ) : (
                            <div className="inline-info">{t('roles.actionOnlyPermission')}</div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </section>

    </div>
  );
}
