export const navigationGroupsMigration = Object.freeze({
  id: '0015-navigation-groups',
  statements: [
    `CREATE TABLE yuncms_navigation_groups (
      id CHAR(36) NOT NULL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      sort INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_yuncms_navigation_groups_sort (sort, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
});
