function normalizeIdentity(value) {
  return value == null ? null : String(value);
}

export function createAccountability(input = {}) {
  const accountability = {
    user: normalizeIdentity(input.user),
    role: normalizeIdentity(input.role),
    admin: input.admin === true,
    public: input.public === true,
    system: input.system === true,
  };

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
