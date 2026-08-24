import { randomUUID } from 'node:crypto';

import { incrementSchemaVersion } from '../schema-version.js';
import { withConnectionTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';
import { assertSchemaManager } from './schema-access.js';

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_PAYLOAD';
  return error;
}

function notFound(id) {
  const error = new Error(`Unknown navigation group: ${id}`);
  error.code = 'NAVIGATION_GROUP_NOT_FOUND';
  return error;
}

function normalizeName(value) {
  if (typeof value !== 'string' || !value.trim()) throw invalid('Navigation group name is required');
  const name = value.trim();
  if (name.length > 100) throw invalid('Navigation group name cannot exceed 100 characters');
  return name;
}

function normalizeSort(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const sort = Number(value);
  if (!Number.isInteger(sort) || sort < -1_000_000 || sort > 1_000_000) {
    throw invalid('Navigation group sort must be an integer between -1000000 and 1000000');
  }
  return sort;
}

export class NavigationGroupsService extends BaseService {
  async readMany() {
    const [rows] = await this.database.query(
      `SELECT id, name, sort, created_at, updated_at
       FROM yuncms_navigation_groups
       ORDER BY sort ASC, name ASC, id ASC`,
    );
    return rows;
  }

  async readOne(id) {
    const [rows] = await this.database.query(
      `SELECT id, name, sort, created_at, updated_at
       FROM yuncms_navigation_groups
       WHERE id = ?
       LIMIT 1`,
      [String(id ?? '')],
    );
    return rows[0] ?? null;
  }

  async createOne(input = {}) {
    assertSchemaManager(this.accountability);
    const id = randomUUID();
    const name = normalizeName(input.name);
    const sort = normalizeSort(input.sort, 0);
    await this.database.query(
      'INSERT INTO yuncms_navigation_groups (id, name, sort) VALUES (?, ?, ?)',
      [id, name, sort],
    );
    return this.readOne(id);
  }

  async updateOne(id, patch = {}) {
    assertSchemaManager(this.accountability);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw invalid('Navigation group patch must be an object');
    const keys = Object.keys(patch);
    if (keys.length === 0 || keys.some((key) => !['name', 'sort'].includes(key))) {
      throw invalid('Navigation group patch contains unsupported properties');
    }
    const assignments = [];
    const params = [];
    if (Object.hasOwn(patch, 'name')) {
      assignments.push('name = ?');
      params.push(normalizeName(patch.name));
    }
    if (Object.hasOwn(patch, 'sort')) {
      assignments.push('sort = ?');
      params.push(normalizeSort(patch.sort));
    }
    params.push(String(id ?? ''));
    const [result] = await this.database.query(
      `UPDATE yuncms_navigation_groups SET ${assignments.join(', ')} WHERE id = ?`,
      params,
    );
    if (!result.affectedRows && !await this.readOne(id)) throw notFound(id);
    return this.readOne(id);
  }

  async deleteOne(id) {
    assertSchemaManager(this.accountability);
    const groupId = String(id ?? '');
    return withConnectionTransaction(this.database, async (connection) => {
      const [existing] = await connection.query(
        'SELECT id FROM yuncms_navigation_groups WHERE id = ? LIMIT 1',
        [groupId],
      );
      if (!existing[0]) throw notFound(groupId);
      const [cleanup] = await connection.query(
        `UPDATE yuncms_collections
         SET metadata = JSON_REMOVE(metadata, '$.group')
         WHERE metadata IS NOT NULL
           AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.group')) = ?`,
        [groupId],
      );
      await connection.query('DELETE FROM yuncms_navigation_groups WHERE id = ?', [groupId]);
      if (Number(cleanup.affectedRows ?? 0) > 0) await incrementSchemaVersion(connection);
      return { deleted: true, id: groupId };
    });
  }
}

export { normalizeName as normalizeNavigationGroupName, normalizeSort as normalizeNavigationGroupSort };
