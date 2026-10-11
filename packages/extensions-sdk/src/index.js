// A global brand also works when an extension installs its own SDK copy.
const EXTENSION_ERROR = Symbol.for('yuncms.extension-error');
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

export class ExtensionError extends Error {
  constructor(code, message, { status = 400, path, cause } = {}) {
    if (typeof code !== 'string' || !ERROR_CODE_PATTERN.test(code)) {
      throw new TypeError('Extension error code must be an uppercase identifier of at most 64 characters');
    }
    if (typeof message !== 'string' || message.trim() === '') {
      throw new TypeError('Extension error requires a public message');
    }
    if (!Number.isInteger(status) || status < 400 || status > 499) {
      throw new TypeError('Extension error status must be an integer from 400 to 499');
    }
    if (path !== undefined && (typeof path !== 'string' || path.trim() === '')) {
      throw new TypeError('Extension error path must be a non-empty string');
    }
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ExtensionError';
    Object.defineProperties(this, {
      [EXTENSION_ERROR]: { value: true },
      code: { value: code, enumerable: true },
      status: { value: status, enumerable: true },
      ...(path === undefined ? {} : { path: { value: path, enumerable: true } }),
    });
  }
}

export function isExtensionError(error) {
  return error?.[EXTENSION_ERROR] === true
    && typeof error.code === 'string' && ERROR_CODE_PATTERN.test(error.code)
    && typeof error.message === 'string' && error.message.trim() !== ''
    && Number.isInteger(error.status) && error.status >= 400 && error.status <= 499;
}

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
