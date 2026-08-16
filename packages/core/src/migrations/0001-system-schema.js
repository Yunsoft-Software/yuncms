export const systemSchemaMigration = {
  id: '0001-system-schema',
  statements: [
    `CREATE TABLE IF NOT EXISTS yuncms_schema_state (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      version BIGINT UNSIGNED NOT NULL DEFAULT 0,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      CONSTRAINT chk_yuncms_schema_state_singleton CHECK (id = 1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `INSERT IGNORE INTO yuncms_schema_state (id, version) VALUES (1, 0)`,

    `CREATE TABLE IF NOT EXISTS yuncms_collections (
      collection VARCHAR(64) NOT NULL PRIMARY KEY,
      primary_key VARCHAR(64) NOT NULL DEFAULT 'id',
      note TEXT NULL,
      singleton TINYINT(1) NOT NULL DEFAULT 0,
      hidden TINYINT(1) NOT NULL DEFAULT 0,
      system TINYINT(1) NOT NULL DEFAULT 0,
      metadata JSON NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS yuncms_fields (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      collection VARCHAR(64) NOT NULL,
      field VARCHAR(64) NOT NULL,
      type VARCHAR(32) NOT NULL,
      required TINYINT(1) NOT NULL DEFAULT 0,
      readonly TINYINT(1) NOT NULL DEFAULT 0,
      hidden TINYINT(1) NOT NULL DEFAULT 0,
      sort INT NULL,
      interface VARCHAR(64) NULL,
      options JSON NULL,
      schema_metadata JSON NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_yuncms_fields_collection_field (collection, field),
      CONSTRAINT fk_yuncms_fields_collection FOREIGN KEY (collection)
        REFERENCES yuncms_collections (collection) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS yuncms_relations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      many_collection VARCHAR(64) NOT NULL,
      many_field VARCHAR(64) NOT NULL,
      one_collection VARCHAR(64) NOT NULL,
      one_field VARCHAR(64) NULL,
      junction_collection VARCHAR(64) NULL,
      junction_field VARCHAR(64) NULL,
      on_delete VARCHAR(16) NOT NULL DEFAULT 'RESTRICT',
      metadata JSON NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_yuncms_relation_many (many_collection, many_field)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS yuncms_roles (
      id CHAR(36) NOT NULL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT NULL,
      admin TINYINT(1) NOT NULL DEFAULT 0,
      public TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_yuncms_roles_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS yuncms_users (
      id CHAR(36) NOT NULL PRIMARY KEY,
      email VARCHAR(191) NOT NULL,
      password_hash VARCHAR(255) NULL,
      role CHAR(36) NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      email_verified_at DATETIME(3) NULL,
      last_access DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_yuncms_users_email (email),
      KEY idx_yuncms_users_role (role),
      CONSTRAINT fk_yuncms_users_role FOREIGN KEY (role)
        REFERENCES yuncms_roles (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS yuncms_sessions (
      id CHAR(36) NOT NULL PRIMARY KEY,
      user CHAR(36) NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      last_used_at DATETIME(3) NULL,
      ip VARCHAR(45) NULL,
      user_agent VARCHAR(512) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_yuncms_sessions_token_hash (token_hash),
      KEY idx_yuncms_sessions_user (user),
      KEY idx_yuncms_sessions_expires_at (expires_at),
      CONSTRAINT fk_yuncms_sessions_user FOREIGN KEY (user)
        REFERENCES yuncms_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS yuncms_permissions (
      id CHAR(36) NOT NULL PRIMARY KEY,
      role CHAR(36) NOT NULL,
      collection VARCHAR(64) NOT NULL,
      action VARCHAR(16) NOT NULL,
      fields JSON NULL,
      filter JSON NULL,
      validation JSON NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_yuncms_permissions_scope (role, collection, action),
      CONSTRAINT fk_yuncms_permissions_role FOREIGN KEY (role)
        REFERENCES yuncms_roles (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS yuncms_api_tokens (
      id CHAR(36) NOT NULL PRIMARY KEY,
      user CHAR(36) NOT NULL,
      name VARCHAR(100) NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME(3) NULL,
      last_used_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_yuncms_api_tokens_hash (token_hash),
      KEY idx_yuncms_api_tokens_user (user),
      CONSTRAINT fk_yuncms_api_tokens_user FOREIGN KEY (user)
        REFERENCES yuncms_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS yuncms_files (
      id CHAR(36) NOT NULL PRIMARY KEY,
      storage VARCHAR(64) NOT NULL DEFAULT 'local',
      filename_disk VARCHAR(255) NOT NULL,
      filename_download VARCHAR(255) NOT NULL,
      title VARCHAR(255) NULL,
      mimetype VARCHAR(191) NULL,
      filesize BIGINT UNSIGNED NULL,
      uploaded_by CHAR(36) NULL,
      uploaded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      metadata JSON NULL,
      UNIQUE KEY uq_yuncms_files_disk (storage, filename_disk),
      KEY idx_yuncms_files_uploaded_by (uploaded_by),
      CONSTRAINT fk_yuncms_files_uploaded_by FOREIGN KEY (uploaded_by)
        REFERENCES yuncms_users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS yuncms_audit_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user CHAR(36) NULL,
      action VARCHAR(32) NOT NULL,
      collection VARCHAR(64) NULL,
      item_key VARCHAR(191) NULL,
      request_id VARCHAR(64) NULL,
      ip VARCHAR(45) NULL,
      payload JSON NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_yuncms_audit_user (user),
      KEY idx_yuncms_audit_collection_item (collection, item_key),
      KEY idx_yuncms_audit_created_at (created_at),
      CONSTRAINT fk_yuncms_audit_user FOREIGN KEY (user)
        REFERENCES yuncms_users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
