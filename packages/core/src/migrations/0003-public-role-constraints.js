export const publicRoleConstraintsMigration = {
  id: '0003-public-role-constraints',
  statements: [
    `ALTER TABLE yuncms_roles
      ADD COLUMN public_singleton TINYINT
        GENERATED ALWAYS AS (CASE WHEN public = 1 THEN 1 ELSE NULL END) STORED,
      ADD UNIQUE KEY uq_yuncms_roles_single_public (public_singleton),
      ADD CONSTRAINT chk_yuncms_roles_admin_not_public CHECK (NOT (admin = 1 AND public = 1))`,
  ],
};
