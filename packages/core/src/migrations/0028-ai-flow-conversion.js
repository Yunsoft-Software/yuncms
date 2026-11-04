export const aiFlowConversionMigration = Object.freeze({
  id: '0028-ai-flow-conversion',
  statements: [
    'ALTER TABLE yuncms_ai_automations ADD COLUMN flow_id CHAR(36) NULL, ADD UNIQUE KEY uq_ai_automation_flow (flow_id), ADD CONSTRAINT fk_ai_automation_flow FOREIGN KEY (flow_id) REFERENCES yuncms_flows (id) ON DELETE SET NULL',
  ],
});
