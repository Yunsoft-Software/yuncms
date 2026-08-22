import { SAML } from '@node-saml/node-saml';
import {
  createExternalAuthState,
  hashExternalAuthState,
} from '@yunsoft/yuncms-core';
import { Client as LdapClient, Filter } from 'ldapts';
import * as oauth from 'openid-client';

import { findExternalAuthProvider } from './config.js';

const SAML_CACHE_PROVIDER = '__saml_cache__';
const BROWSER_HANDOFF_PROVIDER = 'handoff';
const BROWSER_HANDOFF_TTL_MS = 60_000;
const SAML_REQUEST_TTL_MS = 5 * 60_000;

function authError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function callbackUrl(publicUrl, provider) {
  return `${publicUrl}/auth/callback/${encodeURIComponent(provider.id)}`;
}

function scalarClaim(value) {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return value;
}

function booleanClaim(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  return false;
}

function normalizeLdapSubject(value) {
  const scalar = scalarClaim(value);
  if (Buffer.isBuffer(scalar)) {
    if (scalar.byteLength === 0) return null;
    return `hex:${scalar.toString('hex')}`;
  }
  if (scalar instanceof Uint8Array) {
    if (scalar.byteLength === 0) return null;
    return `hex:${Buffer.from(scalar).toString('hex')}`;
  }
  if (typeof scalar !== 'string') return null;
  const normalized = scalar.trim();
  return normalized || null;
}

function mappedIdentity(provider, profile, { defaultEmailVerified = false } = {}) {
  const subject = scalarClaim(profile?.[provider.claims?.subject ?? 'sub']);
  const email = scalarClaim(profile?.[provider.claims?.email ?? 'email']);
  const emailVerifiedValue = profile?.[provider.claims?.emailVerified ?? 'email_verified'];
  if (typeof subject !== 'string' || !subject.trim()) {
    throw authError('EXTERNAL_IDENTITY_INVALID', 'External provider did not return a usable subject identifier');
  }
  return {
    subject: subject.trim(),
    email: typeof email === 'string' && email.trim() ? email.trim() : null,
    emailVerified: emailVerifiedValue == null ? defaultEmailVerified : booleanClaim(emailVerifiedValue),
    profile,
  };
}

function currentCallbackUrl(publicUrl, provider, query) {
  const url = new URL(callbackUrl(publicUrl, provider));
  for (const [key, value] of Object.entries(query ?? {})) {
    if (Array.isArray(value)) {
      for (const entry of value) url.searchParams.append(key, String(entry));
    } else if (value != null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

class MysqlSamlCacheProvider {
  constructor(database) {
    this.database = database;
  }

  async saveAsync(key, value) {
    const createdAt = Date.now();
    const expiresAt = new Date(createdAt + SAML_REQUEST_TTL_MS);
    await this.database.query(
      `INSERT INTO yuncms_auth_transactions
       (id, provider, state_hash, redirect_target, metadata, expires_at)
       VALUES (?, ?, ?, '/', ?, ?)`,
      [
        crypto.randomUUID(),
        SAML_CACHE_PROVIDER,
        hashExternalAuthState(key),
        JSON.stringify({ value: String(value) }),
        expiresAt,
      ],
    );
    return { value: String(value), createdAt };
  }

  async getAsync(key) {
    if (key == null) return null;
    const [rows] = await this.database.query(
      `SELECT metadata
       FROM yuncms_auth_transactions
       WHERE provider = ? AND state_hash = ? AND used_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP(3)
       LIMIT 1`,
      [SAML_CACHE_PROVIDER, hashExternalAuthState(key)],
    );
    let metadata = rows[0]?.metadata ?? null;
    if (typeof metadata === 'string') {
      try { metadata = JSON.parse(metadata); } catch { metadata = null; }
    }
    return typeof metadata?.value === 'string' ? metadata.value : null;
  }

  async removeAsync(key) {
    if (key == null) return null;
    const value = await this.getAsync(key);
    if (value == null) return null;
    await this.database.query(
      `UPDATE yuncms_auth_transactions
       SET used_at = CURRENT_TIMESTAMP(3)
       WHERE provider = ? AND state_hash = ? AND used_at IS NULL`,
      [SAML_CACHE_PROVIDER, hashExternalAuthState(key)],
    );
    return value;
  }
}

function oauthClientAuthentication(provider) {
  return provider.clientAuth === 'basic'
    ? oauth.ClientSecretBasic(provider.clientSecret)
    : oauth.ClientSecretPost(provider.clientSecret);
}

export class ExternalAuthProviderRegistry {
  constructor({ config, publicUrl, database, logger = console } = {}) {
    this.config = config;
    this.publicUrl = String(publicUrl ?? '').replace(/\/$/, '');
    this.database = database;
    this.logger = logger;
    this.clientCache = new Map();
    this.samlCache = new Map();
  }

  publicProviders() {
    return this.config?.publicProviders ?? [];
  }

  provider(id) {
    return findExternalAuthProvider(this.config, id);
  }

  async #oidcConfiguration(provider) {
    if (!this.clientCache.has(provider.id)) {
      this.clientCache.set(provider.id, oauth.discovery(
        new URL(provider.issuer),
        provider.clientId,
        provider.clientSecret,
        oauth.ClientSecretPost(provider.clientSecret),
      ));
    }
    return this.clientCache.get(provider.id);
  }

  #oauthConfiguration(provider) {
    if (!this.clientCache.has(provider.id)) {
      const configuration = new oauth.Configuration(
        {
          issuer: provider.issuer,
          authorization_endpoint: provider.authorizationEndpoint,
          token_endpoint: provider.tokenEndpoint,
        },
        provider.clientId,
        { client_secret: provider.clientSecret },
        oauthClientAuthentication(provider),
      );
      this.clientCache.set(provider.id, configuration);
    }
    return this.clientCache.get(provider.id);
  }

  #saml(provider) {
    if (!this.samlCache.has(provider.id)) {
      const instance = new SAML({
        callbackUrl: callbackUrl(this.publicUrl, provider),
        entryPoint: provider.entryPoint,
        issuer: provider.issuer,
        idpCert: provider.idpCert,
        ...(provider.idpIssuer ? { idpIssuer: provider.idpIssuer } : {}),
        acceptedClockSkewMs: provider.clockSkewMs,
        validateInResponseTo: 'always',
        requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
        cacheProvider: new MysqlSamlCacheProvider(this.database),
        wantAssertionsSigned: true,
        wantAuthnResponseSigned: true,
        signatureAlgorithm: 'sha256',
      });
      this.samlCache.set(provider.id, instance);
    }
    return this.samlCache.get(provider.id);
  }

  async begin(service, providerId, { redirectTarget = '/' } = {}) {
    const provider = this.provider(providerId);
    if (provider.driver === 'ldap') throw authError('AUTH_PROVIDER_FLOW_MISMATCH', 'LDAP providers use password login');

    if (provider.driver === 'saml') {
      const relayState = createExternalAuthState();
      await service.beginTransaction({
        provider: provider.id,
        state: relayState,
        redirectTarget,
        metadata: { driver: 'saml' },
      });
      const url = await this.#saml(provider).getAuthorizeUrlAsync(relayState, undefined, {});
      return { provider, url: new URL(url) };
    }

    const state = oauth.randomState();
    const codeVerifier = oauth.randomPKCECodeVerifier();
    const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
    const redirectUri = callbackUrl(this.publicUrl, provider);
    const secret = { codeVerifier };
    const parameters = {
      redirect_uri: redirectUri,
      scope: provider.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    };

    let configuration;
    if (provider.driver === 'oidc') {
      const nonce = oauth.randomNonce();
      secret.nonce = nonce;
      parameters.nonce = nonce;
      configuration = await this.#oidcConfiguration(provider);
    } else {
      configuration = this.#oauthConfiguration(provider);
    }

    await service.beginTransaction({
      provider: provider.id,
      state,
      secret,
      redirectTarget,
      metadata: { driver: provider.driver },
    });
    return { provider, url: oauth.buildAuthorizationUrl(configuration, parameters) };
  }

  async #completeOidc(service, provider, query, requestInfo) {
    const state = String(query?.state ?? '');
    if (!state) throw authError('INVALID_AUTH_TRANSACTION', 'OIDC state is required');
    const transaction = await service.consumeTransaction({ provider: provider.id, state });
    const configuration = await this.#oidcConfiguration(provider);
    const tokens = await oauth.authorizationCodeGrant(
      configuration,
      currentCallbackUrl(this.publicUrl, provider, query),
      {
        pkceCodeVerifier: transaction.secret?.codeVerifier,
        expectedState: state,
        expectedNonce: transaction.secret?.nonce,
        idTokenExpected: true,
      },
    );
    const claims = tokens.claims();
    if (!claims?.sub) throw authError('EXTERNAL_IDENTITY_INVALID', 'OIDC ID token did not contain a subject');
    let profile = claims;
    if (tokens.access_token) {
      try {
        profile = await oauth.fetchUserInfo(configuration, tokens.access_token, claims.sub);
      } catch (error) {
        this.logger?.warn?.('OIDC userinfo request failed; using validated ID token claims', { provider: provider.id, code: error?.code ?? null });
      }
    }
    const identity = mappedIdentity(provider, profile);
    const result = await service.completeLogin({
      provider: provider.id,
      ...identity,
      policy: provider.policy,
      ...requestInfo,
    });
    return { result, redirectTarget: transaction.redirectTarget };
  }

  async #completeOauth2(service, provider, query, requestInfo) {
    const state = String(query?.state ?? '');
    if (!state) throw authError('INVALID_AUTH_TRANSACTION', 'OAuth state is required');
    const transaction = await service.consumeTransaction({ provider: provider.id, state });
    const configuration = this.#oauthConfiguration(provider);
    const tokens = await oauth.authorizationCodeGrant(
      configuration,
      currentCallbackUrl(this.publicUrl, provider, query),
      {
        pkceCodeVerifier: transaction.secret?.codeVerifier,
        expectedState: state,
      },
    );
    if (!tokens.access_token) throw authError('EXTERNAL_IDENTITY_INVALID', 'OAuth provider did not return an access token');
    const response = await oauth.fetchProtectedResource(
      configuration,
      tokens.access_token,
      new URL(provider.userinfoEndpoint),
      'GET',
    );
    if (!response.ok) throw authError('EXTERNAL_USERINFO_FAILED', 'OAuth user profile request failed');
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw authError('EXTERNAL_USERINFO_FAILED', 'OAuth user profile response must be JSON');
    }
    const profile = await response.json();
    const identity = mappedIdentity(provider, profile);
    const result = await service.completeLogin({
      provider: provider.id,
      ...identity,
      policy: provider.policy,
      ...requestInfo,
    });
    return { result, redirectTarget: transaction.redirectTarget };
  }

  async #completeSaml(service, provider, body, requestInfo) {
    const relayState = String(body?.RelayState ?? '');
    const response = String(body?.SAMLResponse ?? '');
    if (!relayState || !response) throw authError('INVALID_AUTH_TRANSACTION', 'SAML response and RelayState are required');
    const validation = await this.#saml(provider).validatePostResponseAsync({ SAMLResponse: response });
    if (validation.loggedOut || !validation.profile?.nameID) {
      throw authError('EXTERNAL_IDENTITY_INVALID', 'SAML response did not contain an authenticated identity');
    }
    const transaction = await service.consumeTransaction({ provider: provider.id, state: relayState });
    const profile = validation.profile;
    const rawEmail = scalarClaim(profile[provider.emailAttribute] ?? profile.email ?? profile.mail);
    const result = await service.completeLogin({
      provider: provider.id,
      subject: profile.nameID,
      email: typeof rawEmail === 'string' ? rawEmail : null,
      emailVerified: true,
      profile,
      policy: provider.policy,
      ...requestInfo,
    });
    return { result, redirectTarget: transaction.redirectTarget };
  }

  async completeBrowser(service, providerId, { query = {}, body = {}, ip = null, userAgent = null } = {}) {
    const provider = this.provider(providerId);
    const requestInfo = { ip, userAgent };
    if (provider.driver === 'oidc') return this.#completeOidc(service, provider, query, requestInfo);
    if (provider.driver === 'oauth2') return this.#completeOauth2(service, provider, query, requestInfo);
    if (provider.driver === 'saml') return this.#completeSaml(service, provider, body, requestInfo);
    throw authError('AUTH_PROVIDER_FLOW_MISMATCH', 'LDAP providers do not use browser callbacks');
  }

  async loginLdap(service, providerId, { username, password, ip = null, userAgent = null } = {}) {
    const provider = this.provider(providerId);
    if (provider.driver !== 'ldap') throw authError('AUTH_PROVIDER_FLOW_MISMATCH', 'Provider does not support LDAP password login');
    const login = String(username ?? '').trim();
    const secret = typeof password === 'string' ? password : '';
    if (!login || login.length > 255 || !secret || secret.length > 4096) {
      throw authError('INVALID_CREDENTIALS', 'Invalid username or password');
    }

    const client = new LdapClient({ url: provider.url, timeout: 10_000, connectTimeout: 10_000 });
    try {
      if (provider.bindDn) await client.bind(provider.bindDn, provider.bindPassword ?? '');
      const filter = `(${provider.userAttribute}=${Filter.escape(login)})`;
      const { searchEntries } = await client.search(provider.baseDn, {
        scope: 'sub',
        filter,
        sizeLimit: 2,
        timeLimit: 10,
        attributes: [...new Set([provider.subjectAttribute, provider.emailAttribute])],
      });
      if (searchEntries.length !== 1) throw authError('INVALID_CREDENTIALS', 'Invalid username or password');
      const entry = searchEntries[0];
      const subject = normalizeLdapSubject(entry[provider.subjectAttribute]);
      if (!subject) {
        throw authError(
          'EXTERNAL_IDENTITY_INVALID',
          `LDAP entry did not return configured stable subject attribute: ${provider.subjectAttribute}`,
        );
      }
      await client.bind(entry.dn, secret);
      const rawEmail = scalarClaim(entry[provider.emailAttribute]);
      return service.completeLogin({
        provider: provider.id,
        subject,
        email: typeof rawEmail === 'string' ? rawEmail : null,
        emailVerified: true,
        profile: {
          preferred_username: login,
          subject_attribute: provider.subjectAttribute,
        },
        policy: provider.policy,
        ip,
        userAgent,
      });
    } catch (error) {
      if (error?.code?.startsWith?.('EXTERNAL_')) throw error;
      throw authError('INVALID_CREDENTIALS', 'Invalid username or password');
    } finally {
      await client.unbind().catch(() => {});
    }
  }

  async createBrowserHandoff(service, result, redirectTarget) {
    const authCode = createExternalAuthState(32);
    await service.beginTransaction({
      provider: BROWSER_HANDOFF_PROVIDER,
      state: authCode,
      secret: result,
      redirectTarget,
      metadata: { kind: 'browser-handoff' },
      ttlMs: BROWSER_HANDOFF_TTL_MS,
    });
    const target = new URL(redirectTarget, 'https://local.yuncms.invalid');
    target.searchParams.set('auth_code', authCode);
    return `${target.pathname}${target.search}${target.hash}`;
  }

  async exchangeBrowserHandoff(service, authCode) {
    const transaction = await service.consumeTransaction({ provider: BROWSER_HANDOFF_PROVIDER, state: authCode });
    if (!transaction.secret || typeof transaction.secret !== 'object') {
      throw authError('INVALID_AUTH_TRANSACTION', 'Authentication handoff is invalid');
    }
    return transaction.secret;
  }
}

export {
  BROWSER_HANDOFF_PROVIDER,
  BROWSER_HANDOFF_TTL_MS,
  MysqlSamlCacheProvider,
  normalizeLdapSubject,
  SAML_REQUEST_TTL_MS,
};
