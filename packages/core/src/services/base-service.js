import { requireAccountability } from '../accountability.js';
import { filterNativeMutation } from '../native-lifecycle.js';

export class BaseService {
  async filter(event, payload, context = {}) {
    return filterNativeMutation(this, event, payload, context);
  }

  constructor({
    accountability,
    database,
    schema = null,
    emitter = null,
    logger = console,
    storage = null,
    permissionCache = null,
    requestId = null,
  } = {}) {
    requireAccountability(accountability);
    if (!database) throw new Error('Database handle is required');

    this.accountability = accountability;
    this.database = database;
    this.schema = schema;
    this.emitter = emitter;
    this.logger = logger;
    this.storage = storage;
    this.permissionCache = permissionCache;
    this.requestId = requestId;
  }
}
