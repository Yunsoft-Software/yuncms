export const systemPermissionResourcesMigration = {
  id: '0007-system-permission-resources',
  statements: [
    `INSERT IGNORE INTO yuncms_collections
      (collection, primary_key, note, singleton, hidden, \`system\`, metadata)
     VALUES
      ('yuncms_users', 'id', 'System users resource', 0, 1, 1,
        JSON_OBJECT('permissionManaged', TRUE, 'permissionMode', 'action-only', 'resource', 'users',
          'allowedActions', JSON_ARRAY('read', 'create', 'update', 'delete'))),
      ('yuncms_files', 'id', 'System files resource', 0, 1, 1,
        JSON_OBJECT('permissionManaged', TRUE, 'permissionMode', 'action-only', 'resource', 'files',
          'allowedActions', JSON_ARRAY('read', 'create', 'update', 'delete'))),
      ('yuncms_roles', 'id', 'System roles resource', 0, 1, 1,
        JSON_OBJECT('permissionManaged', TRUE, 'permissionMode', 'action-only', 'resource', 'roles',
          'allowedActions', JSON_ARRAY('read')))`,

    `INSERT IGNORE INTO yuncms_fields
      (collection, field, type, required, readonly, hidden, interface, schema_metadata)
     VALUES
      ('yuncms_users', 'id', 'uuid', 1, 1, 0, 'input', JSON_OBJECT('primaryKey', TRUE, 'length', 36)),
      ('yuncms_users', 'email', 'string', 1, 0, 0, 'input', JSON_OBJECT('length', 191)),
      ('yuncms_users', 'role', 'uuid', 0, 0, 0, 'input', JSON_OBJECT('length', 36)),
      ('yuncms_users', 'status', 'string', 1, 0, 0, 'input', JSON_OBJECT('length', 32)),
      ('yuncms_users', 'email_verified_at', 'datetime', 0, 1, 0, 'datetime', NULL),
      ('yuncms_users', 'last_access', 'datetime', 0, 1, 0, 'datetime', NULL),
      ('yuncms_users', 'created_at', 'datetime', 1, 1, 0, 'datetime', JSON_OBJECT('special', 'date-created', 'systemManaged', TRUE)),
      ('yuncms_users', 'updated_at', 'datetime', 1, 1, 0, 'datetime', JSON_OBJECT('special', 'date-updated', 'systemManaged', TRUE)),

      ('yuncms_files', 'id', 'uuid', 1, 1, 0, 'input', JSON_OBJECT('primaryKey', TRUE, 'length', 36)),
      ('yuncms_files', 'storage', 'string', 1, 1, 0, 'input', JSON_OBJECT('length', 64)),
      ('yuncms_files', 'filename_download', 'string', 1, 0, 0, 'input', JSON_OBJECT('length', 255)),
      ('yuncms_files', 'title', 'string', 0, 0, 0, 'input', JSON_OBJECT('length', 255)),
      ('yuncms_files', 'mimetype', 'string', 0, 1, 0, 'input', JSON_OBJECT('length', 191)),
      ('yuncms_files', 'filesize', 'bigint', 0, 1, 0, 'input', NULL),
      ('yuncms_files', 'uploaded_by', 'uuid', 0, 1, 0, 'user', JSON_OBJECT('length', 36)),
      ('yuncms_files', 'uploaded_at', 'datetime', 1, 1, 0, 'datetime', JSON_OBJECT('special', 'date-created', 'systemManaged', TRUE)),

      ('yuncms_roles', 'id', 'uuid', 1, 1, 0, 'input', JSON_OBJECT('primaryKey', TRUE, 'length', 36)),
      ('yuncms_roles', 'name', 'string', 1, 1, 0, 'input', JSON_OBJECT('length', 100)),
      ('yuncms_roles', 'description', 'text', 0, 1, 0, 'textarea', NULL),
      ('yuncms_roles', 'admin', 'boolean', 1, 1, 0, 'boolean', NULL),
      ('yuncms_roles', 'public', 'boolean', 1, 1, 0, 'boolean', NULL)`,

    `UPDATE yuncms_schema_state SET version = version + 1 WHERE id = 1`,
  ],
};
