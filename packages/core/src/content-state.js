// SPDX-FileCopyrightText: 2026 Yunsoft Software
// SPDX-License-Identifier: MIT
import { featureError } from './features.js';
import { quoteIdentifier } from './identifier.js';

export function restrictMutationToKeys(filter, primaryKey, keys) {
  const predicate = keys.length ? `${quoteIdentifier(primaryKey, 'field name')} IN (${keys.map(() => '?').join(', ')})` : '1 = 0';
  return { sql: `${filter.sql}${filter.sql ? ' AND' : ' WHERE'} ${predicate}`, params: [...filter.params, ...keys] };
}

export function contentTracking(schema) {
  let metadata = schema?.metadata;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch { metadata = null; }
  }
  return {
    tracked: metadata?.contentTracking != null && typeof metadata.contentTracking === 'object',
    enabled: metadata?.contentTracking?.enabled === true,
    history: metadata?.contentTracking?.history === true,
  };
}

export function normalizeContentTracking(value = undefined) {
  if (value === undefined) return { enabled: true, history: false };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['enabled', 'history'].includes(key))
    || (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    || (value.history !== undefined && typeof value.history !== 'boolean')) {
    throw featureError('INVALID_SCHEMA_PAYLOAD', 'contentTracking accepts boolean enabled and history options');
  }
  const normalized = { enabled: value.enabled ?? true, history: value.history ?? false };
  if (normalized.history && !normalized.enabled) throw featureError('INVALID_SCHEMA_PAYLOAD', 'Content history requires concurrency tracking');
  return normalized;
}

export function parseItemRevision(value) {
  if (value == null) return null;
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(text)
    || BigInt(text) > 18446744073709551615n) {
    throw featureError('INVALID_ITEM_REVISION', 'Revision must be an unsigned integer string');
  }
  return text;
}

export async function readItemRevision(database, collection, key, { current = false } = {}) {
  // A locking/current read is required: a repeatable-read transaction may have
  // established its older snapshot while resolving schema or permissions.
  const [rows] = await database.query(`SELECT revision FROM yuncms_item_versions WHERE collection = ? AND item_key = ?${current ? ' FOR SHARE' : ''}`, [collection, String(key)]);
  return String(rows[0]?.revision ?? 0);
}

export async function advanceItemRevision(database, collection, key) {
  await database.query(`INSERT INTO yuncms_item_versions (collection, item_key, revision) VALUES (?, ?, 1)
    ON DUPLICATE KEY UPDATE revision = revision + 1`, [collection, String(key)]);
  return readItemRevision(database, collection, key, { current: true });
}

export function assertItemRevision(expected, actual) {
  if (expected != null && expected !== actual) {
    throw featureError('ITEM_REVISION_CONFLICT', 'This record changed after it was opened. Your changes were not saved; reload and compare before retrying.');
  }
}
