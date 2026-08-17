export const schemaDisplayNamesMigration = {
  id: '0009-schema-display-names',
  statements: [
    `ALTER TABLE yuncms_collections
      ADD COLUMN name VARCHAR(255) NULL AFTER collection`,
    `UPDATE yuncms_collections
      SET name = collection
      WHERE name IS NULL OR TRIM(name) = ''`,
    `ALTER TABLE yuncms_collections
      MODIFY COLUMN name VARCHAR(255) NOT NULL`,
    `ALTER TABLE yuncms_fields
      ADD COLUMN name VARCHAR(255) NULL AFTER field`,
    `UPDATE yuncms_fields
      SET name = field
      WHERE name IS NULL OR TRIM(name) = ''`,
    `ALTER TABLE yuncms_fields
      MODIFY COLUMN name VARCHAR(255) NOT NULL`,
  ],
};
