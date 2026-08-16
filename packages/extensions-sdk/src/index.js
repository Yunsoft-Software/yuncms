function defineExtension(type, register) {
  if (typeof register !== 'function') {
    throw new TypeError(`${type} extension must provide a register function`);
  }

  return Object.freeze({
    __yuncms_extension__: true,
    type,
    register,
  });
}

export function defineEndpoint(register) {
  return defineExtension('endpoint', register);
}

export function defineHook(register) {
  return defineExtension('hook', register);
}

export function isYunCmsExtension(value, type) {
  if (!value || value.__yuncms_extension__ !== true) return false;
  if (type && value.type !== type) return false;
  return typeof value.register === 'function';
}
