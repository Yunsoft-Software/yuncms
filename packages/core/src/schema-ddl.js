import { transactionContext } from './transaction.js';

export function assertSchemaDDLAllowed(database) {
  if (transactionContext(database)?.state === 'active') {
    throw Object.assign(new Error('Physical schema changes must run outside an application transaction'), {
      code: 'INVALID_SCHEMA_PAYLOAD',
    });
  }
}
