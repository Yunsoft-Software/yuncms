export const aiOutputConstraintsMigration = Object.freeze({
  id: '0026-ai-output-constraints',
  statements: [
    'ALTER TABLE yuncms_ai_automations ADD COLUMN output_constraints JSON NULL AFTER output_fields',
  ],
});
