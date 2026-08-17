export const defaultPublicRoleMigration = {
  id: '0005-default-public-role',
  statements: [
    `INSERT INTO yuncms_roles (id, name, description, admin, public)
     SELECT UUID(),
            CASE
              WHEN EXISTS (SELECT 1 FROM yuncms_roles AS named WHERE named.name = 'Public')
                THEN CONCAT('Public ', LEFT(REPLACE(UUID(), '-', ''), 8))
              ELSE 'Public'
            END,
            'Unauthenticated public API access. No collection access is granted by default.',
            0,
            1
     WHERE NOT EXISTS (SELECT 1 FROM yuncms_roles AS existing WHERE existing.public = 1)`,
  ],
};
