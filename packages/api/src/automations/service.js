import { randomUUID } from 'node:crypto';
import { createAccountability, isSystemManagedField, SchemaCache, withTransaction } from '@yunsoft/yuncms-core';
import { AI_AUTOMATION_ORIGIN, automationError, automationFromRow, matchesAutomation, normalizeAutomation, validateGeneratedFields } from './config.js';

const OUTPUT_TYPES = new Set(['string', 'text', 'json', 'boolean', 'integer', 'bigint', 'decimal', 'date', 'datetime', 'timestamp']);
const COLUMNS = ['name', 'collection', 'run_as', 'enabled', 'on_create', 'on_update', 'input_fields', 'output_fields', 'instruction'];

export class AiAutomationsService {
  constructor({ database, accountability, services, schemaCache = new SchemaCache(), emitter = null,
    storage = null, logger = console, assistant, settingsStore }) {
    if (!database || !accountability || !services) throw new Error('Automation service requires database, accountability and services');
    Object.assign(this, { database, accountability, services, schemaCache, emitter, storage, logger, assistant, settingsStore });
  }

  requireAdministrator() {
    if (!this.accountability.user) throw automationError('UNAUTHORIZED', 'Automations require an authenticated administrator');
    if (!this.accountability.admin) throw automationError('FORBIDDEN', 'Only administrators manage AI automations');
  }

  async list() {
    this.requireAdministrator();
    const [rows] = await this.database.query('SELECT * FROM yuncms_ai_automations ORDER BY created_at DESC');
    return rows.map(automationFromRow);
  }

  async configuration() {
    this.requireAdministrator();
    const schema = await this.schemaCache.get(this.database);
    const [users] = await this.database.query(
      `SELECT u.id, u.email, r.name AS role FROM yuncms_users u INNER JOIN yuncms_roles r ON r.id = u.role
       WHERE u.status = 'active' AND r.admin = 0 AND r.public = 0 ORDER BY u.email LIMIT 500`,
    );
    return { users, collections: Object.values(schema.collections).filter((entry) => !entry.system).map((entry) => ({
      collection: entry.collection, name: entry.name ?? entry.collection,
      fields: Object.values(entry.fields).map((field) => ({ field: field.field, name: field.name ?? field.field,
        output: field.field !== entry.primary_key && !field.readonly && !isSystemManagedField(field)
          && OUTPUT_TYPES.has(field.type) && !schema.relationByManyField?.has(`${entry.collection}.${field.field}`),
      })),
    })) };
  }

  async read(id, database = this.database, { lock = false } = {}) {
    const [rows] = await database.query(`SELECT * FROM yuncms_ai_automations WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
    return automationFromRow(rows[0]);
  }

  async executionOptions(rule, database = this.database) {
    const [users] = await database.query(
      `SELECT u.id, u.role, u.status, r.admin, r.public FROM yuncms_users u
       INNER JOIN yuncms_roles r ON r.id = u.role WHERE u.id = ?`, [rule.run_as],
    );
    const user = users[0];
    if (!user || user.status !== 'active' || user.admin || user.public) {
      throw automationError('INVALID_AUTOMATION', 'Run as must be an active user with a normal, non-public role');
    }
    const schema = await this.schemaCache.get(database);
    const collection = schema.collections?.[rule.collection];
    if (!collection || collection.system) throw automationError('COLLECTION_NOT_FOUND', 'Choose an existing project collection');
    for (const field of [...rule.input_fields, ...rule.output_fields]) {
      if (!collection.fields[field]) throw automationError('FIELD_NOT_FOUND', `Unknown field: ${field}`);
    }
    for (const field of rule.output_fields) {
      const metadata = collection.fields[field];
      if (field === collection.primary_key || metadata.readonly || isSystemManagedField(metadata)
        || !OUTPUT_TYPES.has(metadata.type) || schema.relationByManyField?.has(`${rule.collection}.${field}`)) {
        throw automationError('INVALID_AUTOMATION', `Output field is not writable scalar data: ${field}`);
      }
    }
    const options = { database, schema, accountability: createAccountability({ user: user.id, role: user.role }),
      emitter: this.emitter, storage: this.storage, logger: this.logger };
    const permissions = new this.services.PermissionsService(options);
    const read = await permissions.resolve('read', rule.collection);
    const update = await permissions.resolve('update', rule.collection);
    if ([...rule.input_fields, ...rule.output_fields].some((field) => read.fields != null && !read.fields.includes(field))
      || rule.output_fields.some((field) => update.fields != null && !update.fields.includes(field))) {
      throw automationError('FORBIDDEN_FIELD', 'Run as cannot read the selected fields or update the output fields');
    }
    return options;
  }

  async save(input, id = null) {
    this.requireAdministrator();
    const rule = normalizeAutomation(input);
    await this.executionOptions(rule);
    const values = COLUMNS.map((column) => ['input_fields', 'output_fields'].includes(column)
      ? JSON.stringify(rule[column]) : typeof rule[column] === 'boolean' ? Number(rule[column]) : rule[column]);
    if (id) {
      const [result] = await this.database.query(
        `UPDATE yuncms_ai_automations SET ${COLUMNS.map((column) => `${column} = ?`).join(', ')}, revision = revision + 1 WHERE id = ?`,
        [...values, id],
      );
      if (!result.affectedRows) throw automationError('NOT_FOUND', 'Automation not found');
    } else {
      id = randomUUID();
      await this.database.query(`INSERT INTO yuncms_ai_automations (id, ${COLUMNS.join(', ')}) VALUES (${Array(10).fill('?').join(', ')})`, [id, ...values]);
    }
    return this.read(id);
  }

  async remove(id) {
    this.requireAdministrator();
    await this.database.query('DELETE FROM yuncms_ai_automations WHERE id = ?', [id]);
  }

  async runs(id) {
    this.requireAdministrator();
    const [rows] = await this.database.query(
      'SELECT * FROM yuncms_ai_automation_runs WHERE automation_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [id],
    );
    return rows;
  }

  async retry(id) {
    this.requireAdministrator();
    const [result] = await this.database.query(
      `UPDATE yuncms_ai_automation_runs j JOIN yuncms_ai_automations a ON a.id = j.automation_id
       SET j.status = 'pending', j.attempts = 0, j.error_code = NULL, j.finished_at = NULL, j.available_at = CURRENT_TIMESTAMP(3)
       WHERE j.id = ? AND j.status = 'failed' AND a.enabled = 1 AND a.revision = j.revision`, [id],
    );
    if (!result.affectedRows) throw automationError('INVALID_AUTOMATION', 'Only a failed run of the current enabled rule can be retried');
    return { queued: true };
  }

  async generate(rule, itemKey, database = this.database) {
    const options = await this.executionOptions(rule, database);
    const items = new this.services.ItemsService(rule.collection, options);
    const fields = [...rule.input_fields, ...rule.output_fields];
    const record = await items.readOne(itemKey, { fields });
    if (!record) throw automationError('NOT_FOUND', 'Record is missing or inaccessible to Run as');
    const input = Object.fromEntries(rule.input_fields.map((field) => [field, record[field]]));
    const output = validateGeneratedFields(await this.assistant.generateFields({
      instruction: rule.instruction, input, outputFields: rule.output_fields,
    }), rule.output_fields);
    items.validatePayload(output, options.schema.collections[rule.collection], await items.resolvePermission('update'));
    return { record, output };
  }

  async preview(input, itemKey) {
    this.requireAdministrator();
    if (typeof itemKey !== 'string' || !itemKey || itemKey.length > 191) throw automationError('INVALID_AUTOMATION', 'Provide a sample record key');
    const rule = normalizeAutomation(input);
    const { record, output } = await this.generate(rule, itemKey);
    return { before: Object.fromEntries(rule.output_fields.map((field) => [field, record[field]])), proposed: output };
  }

  async enqueue(event, payload, context) {
    if (!context.collection || context.collection.startsWith('yuncms_')
      || context[AI_AUTOMATION_ORIGIN] === true) return;
    const [rows] = await this.database.query('SELECT * FROM yuncms_ai_automations WHERE collection = ? AND enabled = 1', [context.collection]);
    for (const row of rows) {
      const rule = automationFromRow(row);
      if (!matchesAutomation(rule, event, payload, context)) continue;
      // updateMany has no stable record key; never fan out into an unbounded scan.
      if (payload.key == null) continue;
      const key = String(payload.key);
      if (!key || key.length > 191) continue;
      await withTransaction(this.database, async (connection) => {
        const current = await this.read(rule.id, connection, { lock: true });
        if (!current || current.revision !== rule.revision || !current.enabled) return;
        const [pending] = await connection.query(
          "SELECT id FROM yuncms_ai_automation_runs WHERE automation_id = ? AND revision = ? AND item_key = ? AND status = 'pending' LIMIT 1",
          [rule.id, rule.revision, key],
        );
        if (pending.length) return;
        const [counts] = await connection.query(
          "SELECT COUNT(*) AS total FROM yuncms_ai_automation_runs WHERE automation_id = ? AND status IN ('pending', 'running')", [rule.id],
        );
        if (Number(counts[0].total) >= 1000) {
          this.logger.warn?.('AI automation queue full', { automation: rule.id });
          return;
        }
        await connection.query(
          'INSERT INTO yuncms_ai_automation_runs (id, automation_id, revision, item_key) VALUES (?, ?, ?, ?)',
          [randomUUID(), rule.id, rule.revision, key],
        );
      });
    }
  }
}
