export const rolePermissionActionsMigration = {
  id: '0011-role-permission-actions',
  statements: [
    `UPDATE yuncms_collections
     SET metadata = JSON_SET(
       COALESCE(metadata, JSON_OBJECT()),
       '$.permissionManaged', TRUE,
       '$.permissionMode', 'action-only',
       '$.resource', 'roles',
       '$.allowedActions', JSON_ARRAY('read', 'create', 'update', 'delete')
     )
     WHERE collection = 'yuncms_roles' AND \`system\` = 1`,
    `UPDATE yuncms_schema_state SET version = version + 1 WHERE id = 1`,
  ],
};
