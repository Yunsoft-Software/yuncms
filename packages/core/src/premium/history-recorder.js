// SPDX-FileCopyrightText: 2026 Yunsoft Software
// SPDX-License-Identifier: LicenseRef-YunCMS-Commercial
import { FeaturesService } from '../services/features-service.js';
import { contentTracking } from '../content-state.js';

const PRIVATE_FIELD = /(password|passwd|token|secret|authorization|cookie|api[_-]?key|credential)/i;

export function historySnapshot(record, schema) {
  if (!record) return null;
  const snapshot = {};
  for (const [field, value] of Object.entries(record)) {
    const definition = schema.fields[field];
    if (!Object.hasOwn(schema.fields, field) || !definition || PRIVATE_FIELD.test(field) || definition.interface === 'password'
      || ['binary', 'blob'].includes(definition.type)) continue;
    if (hasPrivateValue(value)) continue;
    snapshot[field] = redactValue(value);
  }
  return snapshot;
}

function hasPrivateValue(value, depth = 0) {
  if (depth >= 12) return true;
  if (value === null || typeof value !== 'object' || value instanceof Date) return false;
  if (Array.isArray(value)) return value.some(entry => hasPrivateValue(entry, depth + 1));
  return Object.entries(value).some(([key, entry]) => PRIVATE_FIELD.test(key) || hasPrivateValue(entry, depth + 1));
}

function redactValue(value, depth = 0) {
  if (depth >= 12) return '[MAX_DEPTH]';
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(entry => redactValue(entry, depth + 1));
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_FIELD.test(key))
    .map(([key, entry]) => [key, redactValue(entry, depth + 1)]));
}

export async function recordContentRevision(service, schema, key, revision, action, record) {
  if (!contentTracking(schema).history) return;
  try {
    await new FeaturesService(service).assertEnabled('contentHistory');
  } catch (error) {
    if (['FEATURE_NOT_LICENSED', 'FEATURE_DISABLED'].includes(error.code)) return;
    throw error;
  }
  const snapshot = historySnapshot(record, schema);
  await service.database.query(`INSERT INTO yuncms_content_revisions
    (collection, item_key, revision, action, actor, snapshot) VALUES (?, ?, ?, ?, ?, ?)`,
  [service.collection, String(key), revision, action, service.accountability.user ?? null,
    snapshot == null ? null : JSON.stringify(snapshot)]);
}
