import { BaseService } from './base-service.js';

const SENSITIVE_KEY = /(password|passwd|token|secret|authorization|cookie|api[_-]?key|credential)/i;
const MAX_DEPTH = 12;

function auditError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertAuditReader(accountability) {
  if (accountability.admin === true || accountability.system === true) return;
  throw auditError('FORBIDDEN', 'Audit log access requires administrator accountability');
}

export function redactAuditValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((entry) => redactAuditValue(entry, depth + 1, seen));
    seen.delete(value);
    return result;
  }

  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? '[REDACTED]'
      : redactAuditValue(entry, depth + 1, seen);
  }
  seen.delete(value);
  return result;
}

function decodePayload(value) {
  if (value == null || typeof value === 'object') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export class AuditService extends BaseService {
  async record({
    user = this.accountability.user ?? null,
    action,
    collection = null,
    itemKey = null,
    requestId = this.requestId ?? null,
    ip = null,
    payload = null,
  } = {}) {
    if (typeof action !== 'string' || !action.trim() || action.length > 32) {
      throw auditError('INVALID_AUDIT_EVENT', 'Audit action is required and must not exceed 32 characters');
    }
    if (collection != null && (typeof collection !== 'string' || collection.length > 64)) {
      throw auditError('INVALID_AUDIT_EVENT', 'Audit collection is invalid');
    }
    if (itemKey != null && String(itemKey).length > 191) {
      throw auditError('INVALID_AUDIT_EVENT', 'Audit item key is too long');
    }

    const redacted = payload == null ? null : redactAuditValue(payload);
    const [result] = await this.database.query(
      `INSERT INTO yuncms_audit_log
       (user, action, collection, item_key, request_id, ip, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        user,
        action.trim(),
        collection,
        itemKey == null ? null : String(itemKey),
        requestId == null ? null : String(requestId).slice(0, 64),
        ip == null ? null : String(ip).slice(0, 45),
        redacted == null ? null : JSON.stringify(redacted),
      ],
    );
    return result.insertId ?? null;
  }

  async readMany({ limit = 100, offset = 0, collection = null, user = null } = {}) {
    assertAuditReader(this.accountability);
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
    const safeOffset = Number.isInteger(offset) ? Math.max(offset, 0) : 0;
    const where = [];
    const params = [];

    if (collection) {
      where.push('collection = ?');
      params.push(collection);
    }
    if (user) {
      where.push('user = ?');
      params.push(user);
    }
    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

    const [rows] = await this.database.query(
      `SELECT id, user, action, collection, item_key, request_id, ip, payload, created_at
       FROM yuncms_audit_log${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, safeLimit, safeOffset],
    );
    return rows.map((row) => ({ ...row, payload: decodePayload(row.payload) }));
  }
}
