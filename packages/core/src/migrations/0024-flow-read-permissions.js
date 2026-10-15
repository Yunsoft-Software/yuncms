export const flowReadPermissionsMigration = Object.freeze({
  id: '0024-flow-read-permissions',
  statements: [
    `INSERT IGNORE INTO yuncms_collections (collection, primary_key, note, singleton, hidden, \`system\`, metadata)
      VALUES ('yuncms_flows', 'id', 'Flow definitions and their run history', 0, 1, 1,
        JSON_OBJECT('permissionManaged', TRUE, 'permissionMode', 'filter-read', 'resource', 'flows', 'allowedActions', JSON_ARRAY('read')))`,
    `INSERT IGNORE INTO yuncms_fields (collection, field, type, required, readonly, hidden, interface, schema_metadata) VALUES
      ('yuncms_flows', 'id', 'uuid', 1, 1, 0, 'input', JSON_OBJECT('primaryKey', TRUE, 'length', 36)),
      ('yuncms_flows', 'name', 'string', 1, 1, 0, 'input', JSON_OBJECT('length', 120)),
      ('yuncms_flows', 'status', 'string', 1, 1, 0, 'input', JSON_OBJECT('length', 16)),
      ('yuncms_flows', 'trigger_type', 'string', 1, 1, 0, 'input', JSON_OBJECT('length', 16)),
      ('yuncms_flows', 'user_created', 'uuid', 0, 1, 0, 'user', JSON_OBJECT('length', 36)),
      ('yuncms_flows', 'revision', 'integer', 1, 1, 0, 'input', NULL),
      ('yuncms_flows', 'created_at', 'datetime', 1, 1, 0, 'datetime', NULL),
      ('yuncms_flows', 'updated_at', 'datetime', 1, 1, 0, 'datetime', NULL)`,
    `UPDATE yuncms_schema_state SET version = version + 1 WHERE id = 1`,
  ],
});
