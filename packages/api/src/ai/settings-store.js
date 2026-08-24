import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import {
  aiAdminSettingsFromRow,
  aiRuntimeSettingsFromRow,
  normalizeAiSettingsPatch,
} from './config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const FORMAT_VERSION = 'v1';

function settingsError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

export function encryptAiSecret(value, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw settingsError('AI_SETTINGS_KEY_INVALID', 'AI settings encryption key must contain 32 bytes');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptAiSecret(value, key) {
  if (!value) return null;
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw settingsError('AI_SETTINGS_KEY_INVALID', 'AI settings encryption key must contain 32 bytes');
  }
  const [version, ivText, tagText, encryptedText, ...rest] = String(value).split('.');
  if (version !== FORMAT_VERSION || rest.length > 0 || !ivText || !tagText || !encryptedText) {
    throw settingsError('AI_SECRET_DECRYPT_FAILED', 'Saved AI credential cannot be decrypted');
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw settingsError('AI_SECRET_DECRYPT_FAILED', 'Saved AI credential cannot be decrypted', error);
  }
}

function columnAssignments(normalized, key) {
  const assignments = [];
  const params = [];
  const add = (column, value) => {
    assignments.push(`${column} = ?`);
    params.push(value);
  };

  if (Object.hasOwn(normalized, 'enabled')) add('enabled', normalized.enabled ? 1 : 0);
  if (Object.hasOwn(normalized, 'baseUrl')) add('base_url', normalized.baseUrl);
  if (Object.hasOwn(normalized, 'model')) add('model', normalized.model);
  if (Object.hasOwn(normalized, 'apiKey')) add('api_key_ciphertext', encryptAiSecret(normalized.apiKey, key));
  if (normalized.clearApiKey === true) add('api_key_ciphertext', null);
  if (Object.hasOwn(normalized, 'writesEnabled')) add('writes_enabled', normalized.writesEnabled ? 1 : 0);
  if (Object.hasOwn(normalized, 'maxToolRounds')) add('max_tool_rounds', normalized.maxToolRounds);
  if (Object.hasOwn(normalized, 'maxToolCallsPerRound')) add('max_tool_calls_per_round', normalized.maxToolCallsPerRound);
  if (Object.hasOwn(normalized, 'maxHistory')) add('max_history', normalized.maxHistory);
  if (Object.hasOwn(normalized, 'maxMessageChars')) add('max_message_chars', normalized.maxMessageChars);
  if (Object.hasOwn(normalized, 'maxToolResultBytes')) add('max_tool_result_bytes', normalized.maxToolResultBytes);
  if (Object.hasOwn(normalized, 'maxOutputTokens')) add('max_output_tokens', normalized.maxOutputTokens);
  if (Object.hasOwn(normalized, 'timeoutMs')) add('timeout_ms', normalized.timeoutMs);
  return { assignments, params };
}

export class AiSettingsStore {
  constructor({ database, key } = {}) {
    if (!database) throw new Error('AI settings store requires database');
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('AI settings store requires a 32-byte encryption key');
    this.database = database;
    this.key = key;
  }

  async #row() {
    const [rows] = await this.database.query(
      `SELECT id, enabled, base_url, model, api_key_ciphertext, writes_enabled,
              max_tool_rounds, max_tool_calls_per_round, max_history, max_message_chars,
              max_tool_result_bytes, max_output_tokens, timeout_ms, updated_at
       FROM yuncms_ai_settings
       WHERE id = 1
       LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw settingsError('DATABASE_MIGRATION_REQUIRED', 'AI settings are missing; run YunCMS bootstrap');
    return row;
  }

  async readAdmin() {
    return aiAdminSettingsFromRow(await this.#row());
  }

  async readRuntime() {
    const row = await this.#row();
    const apiKey = decryptAiSecret(row.api_key_ciphertext, this.key);
    return aiRuntimeSettingsFromRow(row, { apiKey });
  }

  async update(patch = {}) {
    const normalized = normalizeAiSettingsPatch(patch);
    const current = await this.#row();
    const { assignments, params } = columnAssignments(normalized, this.key);
    if (assignments.length === 0) throw settingsError('INVALID_AI_CONFIG', 'AI settings patch has no effective changes');

    const effectiveHasKey = Object.hasOwn(normalized, 'apiKey')
      ? true
      : normalized.clearApiKey === true
        ? false
        : Boolean(current.api_key_ciphertext);
    const effectiveModel = Object.hasOwn(normalized, 'model') ? normalized.model : current.model;
    const effectiveEnabled = Object.hasOwn(normalized, 'enabled') ? normalized.enabled : Boolean(current.enabled);
    if (effectiveEnabled && !effectiveHasKey) {
      throw settingsError('INVALID_AI_CONFIG', 'Save an API key before enabling Yapay Zeka');
    }
    if (effectiveEnabled && !effectiveModel) {
      throw settingsError('INVALID_AI_CONFIG', 'Choose a model before enabling Yapay Zeka');
    }

    params.push(1);
    await this.database.query(
      `UPDATE yuncms_ai_settings SET ${assignments.join(', ')} WHERE id = ?`,
      params,
    );
    return this.readAdmin();
  }
}
