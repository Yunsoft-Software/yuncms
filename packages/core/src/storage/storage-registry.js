function assertDriver(name, driver) {
  for (const method of ['put', 'get', 'delete', 'stat', 'getSignedUrl']) {
    if (typeof driver?.[method] !== 'function') {
      throw new Error(`Storage driver ${name} must implement ${method}()`);
    }
  }
  return driver;
}

export function createStorageRegistry(drivers = {}) {
  const entries = Object.entries(drivers);
  if (entries.length === 0) throw new Error('At least one storage driver is required');

  const registry = new Map();
  for (const [name, driver] of entries) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name)) {
      throw new Error(`Invalid storage driver name: ${name}`);
    }
    registry.set(name, assertDriver(name, driver));
  }

  return Object.freeze({
    has(name) {
      return registry.has(name);
    },
    get(name) {
      const driver = registry.get(name);
      if (!driver) {
        const error = new Error(`Unknown storage driver: ${name}`);
        error.code = 'STORAGE_NOT_FOUND';
        throw error;
      }
      return driver;
    },
    names() {
      return Object.freeze([...registry.keys()]);
    },
  });
}
