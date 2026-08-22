const DRIVER_NAMES = new Set(['oidc', 'oauth2', 'ldap', 'saml']);

function configError(message) {
  const error = new Error(message);
  error.code = 'INVALID_AUTH_PROVIDER_CONFIG';
  return error;
}

function readString(env, name, fallback = '') {
  const value = env[name];
  return value == null ? fallback : String(value).trim();
}

function readBoolean(env, name, fallback = false) {
  const value = env[name];
  if (value == null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw configError(`${name} must be true or false`);
}

function requireString(env, name) {
  const value = readString(env, name);
  if (!value) throw configError(`${name} is required`);
  return value;
}

function readUrl(env, name, { protocols = ['https:'], required = true } = {}) {
  const raw = required ? requireString(env, name) : readString(env, name);
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { throw configError(`${name} must be a valid URL`); }
  if (!protocols.includes(url.protocol)) {
    throw configError(`${name} must use ${protocols.join(' or ')}`);
  }
  return url.toString().replace(/\/$/, '');
}

function normalizeProviderId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
    throw configError(`Invalid provider id: ${value}`);
  }
  return id;
}

function envPrefix(id) {
  return `AUTH_PROVIDER_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

function readClaims(env, prefix) {
  return Object.freeze({
    subject: readString(env, `${prefix}_SUBJECT_CLAIM`, 'sub'),
    email: readString(env, `${prefix}_EMAIL_CLAIM`, 'email'),
    emailVerified: readString(env, `${prefix}_EMAIL_VERIFIED_CLAIM`, 'email_verified'),
  });
}

function readPolicy(env, prefix) {
  const jit = readBoolean(env, `${prefix}_JIT`, false);
  const linkByVerifiedEmail = readBoolean(env, `${prefix}_LINK_BY_VERIFIED_EMAIL`, false);
  const defaultRole = readString(env, `${prefix}_DEFAULT_ROLE`) || null;
  if (jit && !defaultRole) throw configError(`${prefix}_DEFAULT_ROLE is required when JIT is enabled`);
  return Object.freeze({
    jit,
    defaultRole,
    linkByVerifiedEmail,
    allowAdminLink: readBoolean(env, `${prefix}_ALLOW_ADMIN_LINK`, false),
  });
}

function readOidc(env, prefix) {
  return Object.freeze({
    issuer: readUrl(env, `${prefix}_ISSUER`),
    clientId: requireString(env, `${prefix}_CLIENT_ID`),
    clientSecret: requireString(env, `${prefix}_CLIENT_SECRET`),
    scopes: readString(env, `${prefix}_SCOPES`, 'openid profile email'),
    claims: readClaims(env, prefix),
  });
}

function readOauth2(env, prefix) {
  return Object.freeze({
    issuer: readUrl(env, `${prefix}_ISSUER`),
    authorizationEndpoint: readUrl(env, `${prefix}_AUTHORIZATION_ENDPOINT`),
    tokenEndpoint: readUrl(env, `${prefix}_TOKEN_ENDPOINT`),
    userinfoEndpoint: readUrl(env, `${prefix}_USERINFO_ENDPOINT`),
    clientId: requireString(env, `${prefix}_CLIENT_ID`),
    clientSecret: requireString(env, `${prefix}_CLIENT_SECRET`),
    clientAuth: readString(env, `${prefix}_CLIENT_AUTH`, 'post').toLowerCase(),
    scopes: readString(env, `${prefix}_SCOPES`, 'profile email'),
    claims: readClaims(env, prefix),
  });
}

function assertLdapAttribute(value, prefix, label) {
  if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(value)) {
    throw configError(`${prefix} ${label} is invalid`);
  }
  return value;
}

function readLdap(env, prefix) {
  const allowInsecure = readBoolean(env, `${prefix}_ALLOW_INSECURE`, false);
  const url = readUrl(env, `${prefix}_URL`, { protocols: allowInsecure ? ['ldap:', 'ldaps:'] : ['ldaps:'] });
  const userAttribute = assertLdapAttribute(
    readString(env, `${prefix}_USER_ATTRIBUTE`, 'uid'),
    prefix,
    'user attribute',
  );
  const subjectAttribute = assertLdapAttribute(
    readString(env, `${prefix}_SUBJECT_ATTRIBUTE`, 'entryUUID'),
    prefix,
    'subject attribute',
  );
  const emailAttribute = assertLdapAttribute(
    readString(env, `${prefix}_EMAIL_ATTRIBUTE`, 'mail'),
    prefix,
    'email attribute',
  );
  return Object.freeze({
    url,
    baseDn: requireString(env, `${prefix}_BASE_DN`),
    bindDn: readString(env, `${prefix}_BIND_DN`) || null,
    bindPassword: readString(env, `${prefix}_BIND_PASSWORD`) || null,
    userAttribute,
    subjectAttribute,
    emailAttribute,
    allowInsecure,
  });
}

function normalizeCertificate(value, name) {
  const certificate = String(value ?? '').replace(/\\n/g, '\n').trim();
  if (!certificate.includes('BEGIN CERTIFICATE') || !certificate.includes('END CERTIFICATE')) {
    throw configError(`${name} must contain a PEM certificate`);
  }
  return certificate;
}

function readSaml(env, prefix) {
  return Object.freeze({
    entryPoint: readUrl(env, `${prefix}_ENTRY_POINT`),
    issuer: requireString(env, `${prefix}_ISSUER`),
    idpCert: normalizeCertificate(requireString(env, `${prefix}_IDP_CERT`), `${prefix}_IDP_CERT`),
    idpIssuer: readString(env, `${prefix}_IDP_ISSUER`) || null,
    emailAttribute: readString(env, `${prefix}_EMAIL_ATTRIBUTE`, 'email'),
    clockSkewMs: Number(readString(env, `${prefix}_CLOCK_SKEW_MS`, '5000')),
  });
}

function providerConfig(env, id) {
  const prefix = envPrefix(id);
  const driver = requireString(env, `${prefix}_DRIVER`).toLowerCase();
  if (!DRIVER_NAMES.has(driver)) throw configError(`${prefix}_DRIVER must be oidc, oauth2, ldap or saml`);
  const common = {
    id,
    label: readString(env, `${prefix}_LABEL`, id),
    driver,
    policy: readPolicy(env, prefix),
  };
  const protocol = driver === 'oidc' ? readOidc(env, prefix)
    : driver === 'oauth2' ? readOauth2(env, prefix)
      : driver === 'ldap' ? readLdap(env, prefix)
        : readSaml(env, prefix);
  if (driver === 'oauth2' && !['post', 'basic'].includes(protocol.clientAuth)) {
    throw configError(`${prefix}_CLIENT_AUTH must be post or basic`);
  }
  if (driver === 'saml' && (!Number.isInteger(protocol.clockSkewMs) || protocol.clockSkewMs < 0 || protocol.clockSkewMs > 120_000)) {
    throw configError(`${prefix}_CLOCK_SKEW_MS must be an integer between 0 and 120000`);
  }
  return Object.freeze({ ...common, ...protocol });
}

export function loadExternalAuthConfig(env = process.env) {
  const rawIds = readString(env, 'AUTH_PROVIDERS');
  const ids = rawIds ? rawIds.split(',').map(normalizeProviderId).filter(Boolean) : [];
  if (new Set(ids).size !== ids.length) throw configError('AUTH_PROVIDERS contains duplicate provider ids');
  const providers = ids.map((id) => providerConfig(env, id));
  const browserEnabled = providers.some((provider) => provider.driver !== 'ldap');
  const stateSecret = readString(env, 'AUTH_STATE_SECRET') || null;
  if (browserEnabled && (!stateSecret || stateSecret.length < 32)) {
    throw configError('AUTH_STATE_SECRET must contain at least 32 characters when browser auth providers are enabled');
  }
  return Object.freeze({
    enabled: providers.length > 0,
    stateSecret,
    providers: Object.freeze(providers),
    publicProviders: Object.freeze(providers.map(({ id, label, driver }) => Object.freeze({ id, label, driver }))),
  });
}

export function findExternalAuthProvider(config, id) {
  const providerId = normalizeProviderId(id);
  const provider = config?.providers?.find((candidate) => candidate.id === providerId);
  if (!provider) {
    const error = new Error('Authentication provider not found');
    error.code = 'AUTH_PROVIDER_NOT_FOUND';
    throw error;
  }
  return provider;
}

export { normalizeProviderId };
