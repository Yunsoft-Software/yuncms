export const navigationGroupCollapseMigration = Object.freeze({
  id: '0016-navigation-group-collapse',
  statements: [
    `ALTER TABLE yuncms_navigation_groups
       ADD COLUMN collapse VARCHAR(16) NOT NULL DEFAULT 'open' AFTER sort`,
  ],
});
