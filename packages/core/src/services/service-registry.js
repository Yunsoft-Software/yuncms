export function createServiceRegistry(initialServices = {}) {
  const services = new Map();

  for (const [name, Service] of Object.entries(initialServices)) {
    register(name, Service);
  }

  function register(name, Service) {
    if (!name || typeof name !== 'string') throw new Error('Service name is required');
    if (typeof Service !== 'function') throw new Error(`Service ${name} must be a constructor`);
    if (services.has(name)) throw new Error(`Service ${name} is already registered`);

    services.set(name, Service);
    return Service;
  }

  function get(name) {
    const Service = services.get(name);
    if (!Service) throw new Error(`Unknown service: ${name}`);
    return Service;
  }

  function has(name) {
    return services.has(name);
  }

  function toObject() {
    return Object.freeze(Object.fromEntries(services.entries()));
  }

  return Object.freeze({ register, get, has, toObject });
}
