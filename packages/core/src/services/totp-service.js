import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { verifyPassword } from '../auth/password.js';
import { hashToken } from '../auth/tokens.js';
import { readAuthenticationUserById } from '../auth/users-repository.js';
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, matchTotpStep, normalizeRecoveryCode, PRIMARY_FACTOR_VERIFIED, SECOND_FACTOR_VERIFIED, totpKey, TOTP_POLICY, totpUri } from '../auth/totp.js';
import { dispatchAfterCommit, withTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';
import { SessionsService } from './sessions-service.js';

const error = (code = 'INVALID_CREDENTIALS', message = 'Invalid or expired authentication verification') => Object.assign(new Error(message), { code });
const publicUser = user => ({ id: user.id, email: user.email, role: user.role ?? null, role_name: user.role_name ?? null, admin: Boolean(user.role_admin ?? user.admin), status: user.status, email_verified_at: user.email_verified_at ?? null });
const fingerprint = user => hashToken(user.password_hash ?? 'external-only-account');
function recoveryHashes(row) {
  const value = typeof row.recovery_hashes === 'string' ? JSON.parse(row.recovery_hashes) : row.recovery_hashes;
  return Array.isArray(value) ? value : [];
}
function newRecoveryCodes(user) {
  const codes = Array.from({ length: TOTP_POLICY.recoveryCodes }, () => randomBytes(16).toString('hex').match(/.{4}/g).join('-'));
  return { codes, hashes: codes.map(c => hashToken(user + ':' + normalizeRecoveryCode(c))) };
}

export class TotpService extends BaseService {
  capabilities() { return { available: Boolean(this.authConfig?.totpKey), algorithm: 'SHA1', digits: 6, period: 30, recovery_codes: TOTP_POLICY.recoveryCodes }; }
  #key() {
    const key = totpKey(this.authConfig?.totpKey);
    if (!key) throw error('TFA_UNAVAILABLE', 'Native TOTP requires a configured AUTH_TOTP_KEY');
    return key;
  }
  #self() {
    if (!this.accountability.user || this.accountability.public) throw error('UNAUTHORIZED', 'Authenticated user is required');
    return this.accountability.user;
  }
  async #state(user, ensure = false) {
    if (ensure) await this.database.query('INSERT IGNORE INTO yuncms_user_totp (user, revision) VALUES (?, ?)', [user, randomUUID()]);
    const [rows] = await this.database.query(`SELECT *, locked_until > UTC_TIMESTAMP(3) AS locked,
      pending_expires_at > UTC_TIMESTAMP(3) AS pending_valid FROM yuncms_user_totp WHERE user = ?`, [user]);
    const row = rows[0] ?? null;
    if (row) { row.locked = Number(row.locked) === 1; row.pending_valid = Number(row.pending_valid) === 1; }
    if (ensure && row.locked_until && !row.locked) {
      await this.database.query('UPDATE yuncms_user_totp SET failed_attempts = 0, locked_until = NULL WHERE user = ?', [user]); row.failed_attempts = 0;
    }
    return row;
  }
  #unlocked(row) { if (row?.locked) throw error('RATE_LIMITED', 'Too many verification attempts; try again later'); }
  async #failure(row, challenge = false) {
    await this.database.query(`UPDATE yuncms_user_totp SET failed_attempts = failed_attempts + 1,
      locked_until = IF(failed_attempts >= ?, TIMESTAMPADD(SECOND, 300, UTC_TIMESTAMP(3)), locked_until) WHERE user = ?`, [TOTP_POLICY.maxAttempts, row.user]);
    if (challenge) await this.database.query('UPDATE yuncms_mfa_challenges SET attempts = attempts + 1 WHERE user = ?', [row.user]);
    return { error: error(challenge ? 'INVALID_CREDENTIALS' : 'INVALID_TFA_VERIFICATION') };
  }
  async #event(event, user, extra = {}, context = {}) {
    if (this.emitter) await dispatchAfterCommit(this.database, (database, transaction) => this.emitter.action(event, { ...(event.startsWith('auth.tfa.') ? { key: user } : {}), user, ...extra }, {
      accountability: this.accountability, requestId: this.requestId, collection: 'yuncms_users', database, transaction, ...context,
    }));
  }
  async #lockedUser(id, operation) {
    const result = await withTransaction(this.database, async database => {
      const service = new TotpService({ ...this, database });
      const user = await readAuthenticationUserById(database, id, { lock: true });
      if (!user || user.status !== 'active') throw error();
      return operation(service, user);
    });
    // Failed attempts must commit; throwing inside the transaction would erase them.
    if (result?.error) throw result.error;
    return result;
  }
  async #session(user, options = {}, verified = false) {
    const tokens = await new SessionsService({ ...this }).createForUser(user, { ...options, ...(verified ? { [SECOND_FACTOR_VERIFIED]: user.id } : {}) });
    return { user: publicUser(user), ...tokens };
  }
  async #rotate(user, verified) {
    await this.database.query('DELETE FROM yuncms_sessions WHERE user = ?', [user.id]);
    await this.database.query('DELETE FROM yuncms_mfa_challenges WHERE user = ?', [user.id]);
    return this.#session(user, {}, verified);
  }
  #factor(row, user, { code, recovery_code: recoveryCode } = {}) {
    if ((code != null) === (recoveryCode != null)) return null;
    if (recoveryCode != null) {
      const normalized = normalizeRecoveryCode(recoveryCode);
      if (!normalized) return null;
      const hashes = recoveryHashes(row), digest = hashToken(user + ':' + normalized);
      const index = hashes.findIndex(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h) && timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(digest, 'hex')));
      return index < 0 ? null : { recoveryHashes: hashes.filter((_, i) => i !== index) };
    }
    const secret = decryptTotpSecret(row.secret_ciphertext, this.#key(), user, 'active');
    const step = matchTotpStep(secret, code, Date.now(), row.last_used_step);
    return step === null ? null : { step };
  }
  async #consume(row, factor) {
    await this.database.query(`UPDATE yuncms_user_totp SET last_used_step = ?, recovery_hashes = ?, failed_attempts = 0, locked_until = NULL WHERE user = ?`,
      [factor.step ?? row.last_used_step, JSON.stringify(factor.recoveryHashes ?? recoveryHashes(row)), row.user]);
  }
  async status() {
    const user = this.#self(), row = await this.#state(user);
    return { ...this.capabilities(), enabled: Boolean(row?.enabled_at), enrollment_pending: Boolean(row?.pending_valid), recovery_codes_remaining: row?.enabled_at ? recoveryHashes(row).length : 0 };
  }
  async beginEnrollment({ password } = {}) {
    const id = this.#self(), key = this.#key();
    return this.#lockedUser(id, async (s, user) => {
      const row = await s.#state(id, true); s.#unlocked(row);
      if (row.enabled_at) throw error('INVALID_PAYLOAD', 'Disable the existing factor before enrolling another');
      if (!await verifyPassword(typeof password === 'string' ? password : '', user.password_hash)) return s.#failure(row);
      const secret = generateTotpSecret();
      await s.database.query(`UPDATE yuncms_user_totp SET pending_ciphertext = ?, pending_expires_at = TIMESTAMPADD(SECOND, 600, UTC_TIMESTAMP(3)) WHERE user = ?`, [encryptTotpSecret(secret, key, id, 'pending'), id]);
      return { secret, otpauth_uri: totpUri(secret, user.email), expires_in: 600 };
    });
  }
  async cancelEnrollment() {
    const id = this.#self();
    return this.#lockedUser(id, async s => {
      await s.database.query('UPDATE yuncms_user_totp SET pending_ciphertext = NULL, pending_expires_at = NULL WHERE user = ?', [id]);
      return { cancelled: true };
    });
  }
  async confirmEnrollment({ password, code } = {}) {
    const id = this.#self(), key = this.#key();
    return this.#lockedUser(id, async (s, user) => {
      const row = await s.#state(id, true); s.#unlocked(row);
      if (row.enabled_at || !row.pending_valid || !row.pending_ciphertext) throw error('INVALID_TFA_VERIFICATION');
      if (!await verifyPassword(typeof password === 'string' ? password : '', user.password_hash)) return s.#failure(row);
      const secret = decryptTotpSecret(row.pending_ciphertext, key, id, 'pending'), step = matchTotpStep(secret, code);
      if (step === null) return s.#failure(row);
      const recovery = newRecoveryCodes(id);
      await s.database.query(`UPDATE yuncms_user_totp SET revision = ?, secret_ciphertext = ?, enabled_at = UTC_TIMESTAMP(3), pending_ciphertext = NULL,
        pending_expires_at = NULL, last_used_step = ?, recovery_hashes = ?, failed_attempts = 0, locked_until = NULL WHERE user = ?`,
        [randomUUID(), encryptTotpSecret(secret, key, id, 'active'), step, JSON.stringify(recovery.hashes), id]);
      const session = await s.#rotate(user, true); await s.#event('auth.tfa.enabled', id);
      return { enabled: true, recovery_codes: recovery.codes, session };
    });
  }
  async #manage(input, disable) {
    const id = this.#self(); this.#key();
    return this.#lockedUser(id, async (s, user) => {
      const row = await s.#state(id, true); s.#unlocked(row);
      if (!row.enabled_at) throw error('INVALID_PAYLOAD', 'TOTP is not enabled');
      if (!await verifyPassword(typeof input?.password === 'string' ? input.password : '', user.password_hash)) return s.#failure(row);
      const factor = s.#factor(row, id, input); if (!factor) return s.#failure(row);
      await s.#consume(row, factor);
      const recovery = disable ? null : newRecoveryCodes(id);
      if (disable) await s.database.query(`UPDATE yuncms_user_totp SET revision = ?, secret_ciphertext = NULL, enabled_at = NULL,
        pending_ciphertext = NULL, pending_expires_at = NULL, last_used_step = NULL, recovery_hashes = NULL WHERE user = ?`, [randomUUID(), id]);
      else await s.database.query('UPDATE yuncms_user_totp SET revision = ?, recovery_hashes = ? WHERE user = ?', [randomUUID(), JSON.stringify(recovery.hashes), id]);
      const session = await s.#rotate(user, !disable); await s.#event(disable ? 'auth.tfa.disabled' : 'auth.tfa.recovery.updated', id);
      return { enabled: !disable, ...(recovery ? { recovery_codes: recovery.codes } : {}), session };
    });
  }
  async disable(input) { return this.#manage(input, true); }
  async regenerateRecoveryCodes(input) { return this.#manage(input, false); }
  async startLogin(primaryUser, options = {}) {
    if (options[PRIMARY_FACTOR_VERIFIED] !== true) throw error('FORBIDDEN', 'Primary identity must be verified by a native authentication service');
    const { method = 'local', provider = null, ip = null, userAgent = null } = options;
    return this.#lockedUser(primaryUser.id, async (s, user) => {
      if (Object.hasOwn(primaryUser, 'password_hash') && primaryUser.password_hash !== user.password_hash) throw error();
      const row = await s.#state(user.id);
      if (!row?.enabled_at) {
        const session = await s.#session(user, { ip, userAgent });
        await s.#event('auth.login.success', user.id, { method, ...(provider ? { provider } : {}), role: user.role ?? null }, { ip });
        return session;
      }
      s.#key(); s.#unlocked(row);
      const token = 'ycm_' + randomBytes(32).toString('base64url');
      await s.database.query(`INSERT INTO yuncms_mfa_challenges (user, token_hash, factor_revision, password_fingerprint, method, provider, expires_at, attempts)
        VALUES (?, ?, ?, ?, ?, ?, TIMESTAMPADD(SECOND, 300, UTC_TIMESTAMP(3)), 0)
        ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), factor_revision = VALUES(factor_revision), password_fingerprint = VALUES(password_fingerprint),
        method = VALUES(method), provider = VALUES(provider), expires_at = VALUES(expires_at), attempts = 0`, [user.id, hashToken(token), row.revision, fingerprint(user), method, provider]);
      return { mfa_required: true, challenge_token: token, expires_in: 300, methods: ['totp', 'recovery_code'] };
    });
  }
  async completeLogin({ challenge_token: token, ...verification } = {}, { ip = null, userAgent = null } = {}) {
    if (typeof token !== 'string' || !/^ycm_[a-zA-Z0-9_-]{43}$/.test(token)) throw error();
    const [rows] = await this.database.query('SELECT user FROM yuncms_mfa_challenges WHERE token_hash = ?', [hashToken(token)]);
    if (!rows[0]) throw error();
    this.#key();
    return this.#lockedUser(rows[0].user, async (s, user) => {
      const [challenges] = await s.database.query(`SELECT *, expires_at > UTC_TIMESTAMP(3) AS valid FROM yuncms_mfa_challenges WHERE user = ? AND token_hash = ? FOR UPDATE`, [user.id, hashToken(token)]);
      const challenge = challenges[0], row = await s.#state(user.id, true); s.#unlocked(row);
      if (Number(challenge?.valid) !== 1 || challenge.attempts >= TOTP_POLICY.challengeAttempts || !row.enabled_at || row.revision !== challenge.factor_revision || fingerprint(user) !== challenge.password_fingerprint) throw error();
      const factor = s.#factor(row, user.id, verification); if (!factor) return s.#failure(row, true);
      await s.#consume(row, factor); await s.database.query('DELETE FROM yuncms_mfa_challenges WHERE user = ?', [user.id]);
      const session = await s.#session(user, { ip, userAgent }, true);
      await s.#event('auth.login.success', user.id, { method: challenge.method, ...(challenge.provider ? { provider: challenge.provider } : {}), role: user.role ?? null, second_factor: true }, { ip });
      return session;
    });
  }
}
