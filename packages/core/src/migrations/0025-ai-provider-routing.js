export const aiProviderRoutingMigration = Object.freeze({
  id: '0025-ai-provider-routing',
  statements: [
    'ALTER TABLE yuncms_ai_settings ADD COLUMN provider JSON NULL AFTER model',
  ],
});
