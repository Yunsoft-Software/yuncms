export const contentFoundationMigration = Object.freeze({
  id: '0029-content-foundation',
  statements: [
    `CREATE TABLE yuncms_license_state (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      token TEXT NOT NULL,
      updated_by CHAR(36) NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      CONSTRAINT chk_license_state_singleton CHECK (id = 1),
      CONSTRAINT fk_license_state_actor FOREIGN KEY (updated_by) REFERENCES yuncms_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE yuncms_feature_settings (
      feature VARCHAR(64) NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL,
      updated_by CHAR(36) NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_feature_settings_actor FOREIGN KEY (updated_by) REFERENCES yuncms_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE yuncms_item_versions (
      collection VARCHAR(64) NOT NULL,
      item_key VARCHAR(191) NOT NULL,
      revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (collection, item_key),
      CONSTRAINT fk_item_versions_collection FOREIGN KEY (collection) REFERENCES yuncms_collections(collection) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE yuncms_content_revisions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      collection VARCHAR(64) NOT NULL,
      item_key VARCHAR(191) NOT NULL,
      revision BIGINT UNSIGNED NOT NULL,
      action VARCHAR(16) NOT NULL,
      actor CHAR(36) NULL,
      snapshot JSON NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_content_revision (collection, item_key, revision),
      CONSTRAINT fk_content_revisions_collection FOREIGN KEY (collection) REFERENCES yuncms_collections(collection) ON DELETE CASCADE,
      CONSTRAINT fk_content_revisions_actor FOREIGN KEY (actor) REFERENCES yuncms_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `UPDATE yuncms_collections SET metadata = JSON_SET(COALESCE(metadata, JSON_OBJECT()),
      '$.contentTracking', JSON_OBJECT('enabled', JSON_EXTRACT('true', '$'), 'history', JSON_EXTRACT('false', '$')))
      WHERE \`system\` = 0 AND JSON_EXTRACT(metadata, '$.contentTracking') IS NULL`,
    'UPDATE yuncms_schema_state SET version = version + 1 WHERE id = 1',
  ],
});
