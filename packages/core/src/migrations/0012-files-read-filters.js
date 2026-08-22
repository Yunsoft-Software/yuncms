export const filesReadFiltersMigration = {
  id: '0012-files-read-filters',
  statements: [
    `UPDATE yuncms_collections
     SET metadata = JSON_SET(
       COALESCE(metadata, JSON_OBJECT()),
       '$.permissionMode',
       'filter-read'
     )
     WHERE collection = 'yuncms_files'
       AND \`system\` = 1`,
    `UPDATE yuncms_schema_state SET version = version + 1 WHERE id = 1`,
  ],
};
