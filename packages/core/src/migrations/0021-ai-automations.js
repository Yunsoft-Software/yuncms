export const aiAutomationsMigration = Object.freeze({
  id: '0021-ai-automations',
  statements: [
    `CREATE TABLE yuncms_ai_automations (
      id CHAR(36) NOT NULL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      collection VARCHAR(64) NOT NULL,
      run_as CHAR(36) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      on_create TINYINT(1) NOT NULL DEFAULT 1,
      on_update TINYINT(1) NOT NULL DEFAULT 0,
      input_fields JSON NOT NULL,
      output_fields JSON NOT NULL,
      instruction TEXT NOT NULL,
      revision INT UNSIGNED NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_ai_automations_collection (collection, enabled),
      CONSTRAINT fk_ai_automation_collection FOREIGN KEY (collection)
        REFERENCES yuncms_collections (collection) ON DELETE CASCADE,
      CONSTRAINT fk_ai_automation_user FOREIGN KEY (run_as)
        REFERENCES yuncms_users (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE yuncms_ai_automation_runs (
      id CHAR(36) NOT NULL PRIMARY KEY,
      automation_id CHAR(36) NOT NULL,
      revision INT UNSIGNED NOT NULL,
      item_key VARCHAR(191) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      error_code VARCHAR(100) NULL,
      available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      finished_at DATETIME(3) NULL,
      INDEX idx_ai_automation_queue (status, available_at),
      INDEX idx_ai_automation_history (automation_id, created_at),
      CONSTRAINT fk_ai_automation_run FOREIGN KEY (automation_id)
        REFERENCES yuncms_ai_automations (id) ON DELETE CASCADE,
      CONSTRAINT chk_ai_automation_run_status
        CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
});
