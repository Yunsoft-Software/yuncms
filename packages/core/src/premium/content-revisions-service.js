// SPDX-FileCopyrightText: 2026 Yunsoft Software
// SPDX-License-Identifier: LicenseRef-YunCMS-Commercial
import { ItemsService } from '../services/items-service.js';
import { FeaturesService } from '../services/features-service.js';
import { contentTracking, parseItemRevision } from '../content-state.js';
import { withTransaction } from '../transaction.js';
import { featureError } from '../features.js';
import { isSystemManagedField } from '../system-fields.js';

export function historyRestoreValues(snapshot, schema) {
  return Object.fromEntries(Object.entries(snapshot).filter(([field]) => {
    const definition = Object.hasOwn(schema.fields, field) && schema.fields[field];
    if (!definition || field === schema.primary_key || definition.readonly || isSystemManagedField(definition)) return false;
    let metadata = definition.schema_metadata;
    if (typeof metadata === 'string') {
      try { metadata = JSON.parse(metadata); } catch { metadata = null; }
    }
    return metadata?.defaultPreset !== 'current_user';
  }));
}

export class ContentRevisionsService extends ItemsService {
  async assertHistoryAccess(id) {
    if (!this.accountability.admin && !this.accountability.system) {
      throw featureError('FORBIDDEN', 'Content history management requires an administrator');
    }
    await new FeaturesService(this).assertEnabled('contentHistory');
    const schema = await this.getCollectionSchema();
    const tracking = contentTracking(schema);
    if (!tracking.enabled || !tracking.history) throw featureError('CONTENT_HISTORY_DISABLED', 'Enable content history for this collection first');
    if (!await this.readOne(id)) throw featureError('NOT_FOUND', 'The current record is not accessible');
    return schema;
  }

  async readRevisions(id, { limit = 25, offset = 0 } = {}) {
    await this.assertHistoryAccess(id);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
      throw featureError('INVALID_QUERY', 'Revision pagination must use limit 1-100 and a non-negative integer offset');
    }
    const [rows] = await this.database.query(`SELECT id, revision, action, actor, created_at
      FROM yuncms_content_revisions WHERE collection = ? AND item_key = ? ORDER BY revision DESC LIMIT ? OFFSET ?`,
    [this.collection, String(id), limit, offset]);
    return rows.map(row => ({ ...row, id: String(row.id), revision: String(row.revision) }));
  }

  async readRevision(id, revision) {
    await this.assertHistoryAccess(id);
    const value = parseItemRevision(revision);
    if (value == null) throw featureError('INVALID_ITEM_REVISION', 'A recorded revision is required');
    const [rows] = await this.database.query(`SELECT id, revision, action, actor, snapshot, created_at
      FROM yuncms_content_revisions WHERE collection = ? AND item_key = ? AND revision = ? LIMIT 1`,
    [this.collection, String(id), value]);
    const row = rows[0];
    if (!row) throw featureError('NOT_FOUND', 'Recorded revision not found');
    return { ...row, id: String(row.id), revision: String(row.revision),
      snapshot: typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot };
  }

  async restoreRevision(id, revision, { expectedRevision } = {}) {
    const expected = parseItemRevision(expectedRevision);
    if (expected == null) throw featureError('INVALID_ITEM_REVISION', 'Restoring requires the current item revision');
    return withTransaction(this.database, async database => {
      const service = new ContentRevisionsService(this.collection, { ...this, database });
      const schema = await service.assertHistoryAccess(id);
      const historical = await service.readRevision(id, revision);
      if (!historical.snapshot || historical.action === 'delete') throw featureError('INVALID_PAYLOAD', 'This revision has no restorable record');
      const changes = historyRestoreValues(historical.snapshot, schema);
      return service.updateOne(id, changes, { expectedRevision: expected });
    });
  }
}
