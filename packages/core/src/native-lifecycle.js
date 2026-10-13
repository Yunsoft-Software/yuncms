import { transactionContext } from './transaction.js';

export async function filterNativeMutation(options, event, payload, context = {}) {
  if (!options.emitter) return payload;
  return options.emitter.filter(event, payload, {
    accountability: options.accountability,
    requestId: options.requestId ?? null,
    database: options.database,
    transaction: transactionContext(options.database),
    operation: event.split('.').at(-1),
    ...context,
  });
}
