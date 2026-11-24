// SPDX-FileCopyrightText: 2026 Yunsoft Software
// SPDX-License-Identifier: MIT
import { BaseService } from './base-service.js';
import { FEATURE_CATALOG, assertFeatureName, createFeaturePolicy, effectiveFeatureState, featureError } from '../features.js';
import { withTransaction } from '../transaction.js';
import { AuditService } from './audit-service.js';

export class FeaturesService extends BaseService {
  constructor(options = {}) {
    super(options);
    this.policy = options.featurePolicy ?? createFeaturePolicy();
  }

  async currentPolicy() {
    const [rows] = await this.database.query('SELECT token FROM yuncms_license_state WHERE id = 1');
    return rows[0]?.token ? this.policy.withToken(rows[0].token) : this.policy;
  }

  async readStatus() {
    if (!this.accountability.user && !this.accountability.admin && !this.accountability.system) {
      throw featureError('UNAUTHORIZED', 'Authentication is required');
    }
    const currentPolicy = await this.currentPolicy();
    const [rows] = await this.database.query('SELECT feature, enabled FROM yuncms_feature_settings');
    const overrides = new Map(rows.map(row => [row.feature, Boolean(row.enabled)]));
    const features = {};
    for (const name of Object.keys(FEATURE_CATALOG)) {
      const policy = currentPolicy.describe(name);
      features[name] = effectiveFeatureState(policy, overrides.get(name));
    }
    const isAdmin = Boolean(this.accountability.admin || this.accountability.system);
    const license = isAdmin ? currentPolicy.licenseStatus() : undefined;
    const premiumOffer = isAdmin && currentPolicy.premiumOfferUrl && license?.status !== 'active'
      ? { url: currentPolicy.premiumOfferUrl }
      : undefined;
    return { features, license, ...(premiumOffer ? { premiumOffer } : {}) };
  }

  async readFeature(name, { policy = null } = {}) {
    assertFeatureName(name);
    const descriptor = (policy ?? await this.currentPolicy()).describe(name);
    const [rows] = await this.database.query('SELECT enabled FROM yuncms_feature_settings WHERE feature = ?', [name]);
    return effectiveFeatureState(descriptor, rows[0] ? Boolean(rows[0].enabled) : undefined);
  }

  async assertEnabled(name) {
    const state = await this.readFeature(name);
    if (!state.licensed) throw featureError('FEATURE_NOT_LICENSED', 'This feature requires a valid license');
    if (!state.enabled) throw featureError('FEATURE_DISABLED', 'This feature is disabled');
    return true;
  }

  async update(name, { enabled } = {}) {
    assertFeatureName(name);
    if (!this.accountability.admin && !this.accountability.system) throw featureError('FORBIDDEN', 'Only administrators may change feature settings');
    if (typeof enabled !== 'boolean') throw featureError('INVALID_PAYLOAD', 'enabled must be a boolean');
    const policy = (await this.currentPolicy()).describe(name);
    if (enabled && !policy.allowed) throw featureError(policy.licensed ? 'FEATURE_DISABLED' : 'FEATURE_NOT_LICENSED', 'The operator policy does not grant this feature');
    await withTransaction(this.database, async database => {
      await database.query(`INSERT INTO yuncms_feature_settings (feature, enabled, updated_by)
        VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_by = VALUES(updated_by)`,
      [name, enabled, this.accountability.user ?? null]);
      await new AuditService({ ...this, database }).record({ action: 'features.update', itemKey: name, payload: { enabled } });
    });
    return (await this.readStatus()).features[name];
  }

  async activate(token) {
    if (!this.accountability.admin && !this.accountability.system) throw featureError('FORBIDDEN', 'Only administrators may install a license');
    const normalized = typeof token === 'string' ? token.trim() : '';
    if (!normalized || normalized.split('.').length !== 3) {
      throw featureError('INVALID_LICENSE', 'Paste the full three-part signed entitlement token (JWT), not a short license reference key');
    }
    const baseline = this.policy.licenseStatus();
    if (!baseline.domain && !baseline.configuredDomain) {
      throw featureError('INVALID_LICENSE', 'Configure AUTH_PUBLIC_URL, STUDIO_ORIGIN or YUNCMS_LICENSE_DOMAIN with this installation hostname before activating a license');
    }
    const policy = this.policy.withToken(normalized);
    if (policy.licenseStatus().status !== 'active') throw featureError('INVALID_LICENSE', 'The license signature, product, domain, instance or validity is not accepted');
    await withTransaction(this.database, async database => {
      const [rows] = await database.query('SELECT token FROM yuncms_license_state WHERE id = 1 FOR UPDATE');
      const currentPolicy = rows[0]?.token ? this.policy.withToken(rows[0].token) : this.policy;
      if (!currentPolicy.canReplaceWith(normalized)) {
        throw featureError('INVALID_LICENSE', 'An older or superseded entitlement token cannot replace the current license');
      }
      await database.query(`INSERT INTO yuncms_license_state (id, token, updated_by) VALUES (1, ?, ?)
        ON DUPLICATE KEY UPDATE token = VALUES(token), updated_by = VALUES(updated_by)`, [normalized, this.accountability.user ?? null]);
      await new AuditService({ ...this, database }).record({ action: 'features.activate', payload: policy.licenseStatus() });
    });
    return this.readStatus();
  }
}
