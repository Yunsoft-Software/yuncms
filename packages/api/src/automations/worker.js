import { quoteIdentifier, withConnectionTransaction } from '@yunsoft/yuncms-core';
import { AI_AUTOMATION_ORIGIN, automationError, recordFingerprint } from './config.js';

const RETRYABLE = new Set(['AI_PROVIDER_TIMEOUT', 'AI_PROVIDER_UNAVAILABLE', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

export class AiAutomationWorker {
  constructor(service, { pollMs = 2000 } = {}) {
    this.service = service;
    this.pollMs = pollMs;
    this.active = null;
    this.timer = null;
  }

  start() {
    const poll = () => {
      if (this.active) return;
      this.active = this.tick().catch((error) => {
        this.service.logger.error?.('AI automation worker failed', { code: error.code ?? 'INTERNAL_ERROR' });
      }).finally(() => { this.active = null; });
    };
    this.timer = setInterval(poll, this.pollMs);
    this.timer.unref?.();
    poll();
  }

  async stop() {
    clearInterval(this.timer);
    await this.active;
  }

  async execute(job) {
    const service = this.service;
    const rule = await service.read(job.automation_id);
    if (!rule || !rule.enabled || rule.revision !== job.revision) return 'skipped';
    const settings = await service.settingsStore.readRuntime();
    if (!settings.enabled || !settings.writesEnabled) throw automationError('AI_WRITES_DISABLED', 'Enable AI writes before running automations');
    const { record, output } = await service.generate(rule, job.item_key);
    const allFields = [...rule.input_fields, ...rule.output_fields];
    const fingerprint = recordFingerprint(record, allFields);
    const connection = await service.database.getConnection();
    const actions = [];
    try {
      const status = await withConnectionTransaction(connection, async () => {
        const currentRule = await service.read(rule.id, connection, { lock: true });
        if (!currentRule || !currentRule.enabled || currentRule.revision !== job.revision) return 'skipped';
        const currentSettings = await service.settingsStore.readRuntime();
        if (!currentSettings.enabled || !currentSettings.writesEnabled) throw automationError('AI_WRITES_DISABLED', 'AI writes were disabled');
        const options = await service.executionOptions(currentRule, connection);
        const schema = options.schema.collections[rule.collection];
        // Resolve trusted schema identifiers and lock the row before the authoritative RBAC read.
        await connection.query(`SELECT ${quoteIdentifier(schema.primary_key)} FROM ${quoteIdentifier(schema.collection)} WHERE ${quoteIdentifier(schema.primary_key)} = ? FOR UPDATE`, [job.item_key]);
        const items = new service.services.ItemsService(rule.collection, {
          ...options, requestId: `ai-automation:${job.id}`,
          emitter: service.emitter ? {
            filter: service.emitter.filter.bind(service.emitter),
            action: async (event, payload, context) => { actions.push({ event, payload, context }); },
          } : null,
        });
        const current = await items.readOne(job.item_key, { fields: allFields });
        if (!current || recordFingerprint(current, allFields) !== fingerprint) return 'skipped';
        if (!await items.updateOne(job.item_key, output)) throw automationError('FORBIDDEN', 'Run as cannot update this record');
        await connection.query("UPDATE yuncms_ai_automation_runs SET status = 'succeeded', error_code = NULL, finished_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [job.id]);
        return 'succeeded';
      });
      if (status === 'succeeded') {
        for (const action of actions) {
          await service.emitter.action(action.event, action.payload, { ...action.context, [AI_AUTOMATION_ORIGIN]: true }).catch((error) => {
            service.logger.error?.('AI automation post-commit action failed', { code: error.code ?? 'INTERNAL_ERROR' });
          });
        }
      }
      return status;
    } finally {
      connection.release();
    }
  }

  async tick() {
    const { database } = this.service;
    const connection = await database.getConnection();
    let locked = false;
    try {
      // A connection-scoped, database-specific lock serializes workers across replicas.
      // Crash releases the lock; the next worker recovers the interrupted running job.
      const [locks] = await connection.query("SELECT GET_LOCK(CONCAT('yuncms:ai:', LEFT(SHA2(DATABASE(), 256), 32)), 0) AS acquired");
      locked = Number(locks[0].acquired) === 1;
      if (!locked) return false;
      const [rows] = await connection.query(
        "SELECT * FROM yuncms_ai_automation_runs WHERE status = 'running' OR (status = 'pending' AND available_at <= CURRENT_TIMESTAMP(3)) ORDER BY created_at, id LIMIT 1",
      );
      const job = rows[0];
      if (!job) return false;
      if (job.attempts >= 3) {
        await connection.query("UPDATE yuncms_ai_automation_runs SET status = 'failed', error_code = 'RUN_INTERRUPTED', finished_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [job.id]);
        return true;
      }
      await connection.query("UPDATE yuncms_ai_automation_runs SET status = 'running', attempts = attempts + 1 WHERE id = ?", [job.id]);
      try {
        const status = await this.execute(job);
        await connection.query('UPDATE yuncms_ai_automation_runs SET status = ?, error_code = ?, finished_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
          [status, status === 'skipped' ? 'STALE_OR_DISABLED' : null, job.id]);
      } catch (error) {
        const retry = RETRYABLE.has(error.code) && job.attempts + 1 < 3;
        await connection.query(
          `UPDATE yuncms_ai_automation_runs SET status = ?, error_code = ?,
           available_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
           finished_at = ${retry ? 'NULL' : 'CURRENT_TIMESTAMP(3)'} WHERE id = ?`,
          [retry ? 'pending' : 'failed', String(error.code ?? 'INTERNAL_ERROR').slice(0, 100), 10 * (job.attempts + 1), job.id],
        );
      }
      await connection.query("DELETE FROM yuncms_ai_automation_runs WHERE status IN ('succeeded', 'failed', 'skipped') AND finished_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)");
      return true;
    } finally {
      if (locked) await connection.query("SELECT RELEASE_LOCK(CONCAT('yuncms:ai:', LEFT(SHA2(DATABASE(), 256), 32)))").catch(() => {});
      connection.release();
    }
  }
}
