import { requireAccountability } from '../accountability.js';

export class BaseService {
  constructor({ accountability, database, schema = null, emitter = null, logger = console } = {}) {
    requireAccountability(accountability);
    if (!database) throw new Error('Database handle is required');

    this.accountability = accountability;
    this.database = database;
    this.schema = schema;
    this.emitter = emitter;
    this.logger = logger;
  }
}
