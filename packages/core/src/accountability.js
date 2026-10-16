function normalizeIdentity(value) {
  return value == null ? null : String(value);
}

function normalizeDeniedCollections(value) {
  if (!Array.isArray(value) || value.length > 1000
    || value.some(name => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name))) {
    const error = new Error('A collection fence must be an array of valid collection names');
    error.code = 'INVALID_ACCOUNTABILITY_SCOPE';
    throw error;
  }
  return Object.freeze([...new Set(value)]);
}

export function isAccountabilityCollectionDenied(accountability, collection) {
  if (!Object.hasOwn(accountability, 'deniedCollections')) return false;
  return normalizeDeniedCollections(accountability.deniedCollections).includes(collection);
}

/** Trusted server scope: preserve identity and add restrictions, never grants. */
export function restrictAccountabilityCollections(accountability, deniedCollections = []) {
  requireAccountability(accountability);
  const existing = Object.hasOwn(accountability, 'deniedCollections')
    ? normalizeDeniedCollections(accountability.deniedCollections) : [];
  const additional = normalizeDeniedCollections(deniedCollections);
  return Object.freeze({ ...accountability,
    deniedCollections: normalizeDeniedCollections([...new Set([...existing, ...additional])]),
  });
}

export function createAccountability(input = {}) {
  const accountability = {
    user: normalizeIdentity(input.user),
    role: normalizeIdentity(input.role),
    admin: input.admin === true,
    public: input.public === true,
    system: input.system === true,
  };
  if (Object.hasOwn(input, 'deniedCollections')) {
    accountability.deniedCollections = normalizeDeniedCollections(input.deniedCollections);
  }

  if (accountability.public && (accountability.user || accountability.admin || accountability.system)) {
    throw new Error('Public accountability cannot also be user, admin, or system accountability');
  }

  if (accountability.system && !accountability.admin) {
    throw new Error('System accountability must explicitly be administrative');
  }

  return Object.freeze(accountability);
}

export function createPublicAccountability({ role = null } = {}) {
  return createAccountability({ role, public: true });
}

export function createSystemAccountability() {
  return createAccountability({ admin: true, system: true });
}

export function requireAccountability(accountability) {
  if (!accountability || typeof accountability !== 'object') {
    throw new Error('Explicit accountability is required');
  }

  return accountability;
}
