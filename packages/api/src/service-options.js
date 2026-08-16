export function serviceOptionsFromRequest(req) {
  if (!req?.context) throw new Error('Request context is required');

  return {
    accountability: req.accountability,
    database: req.context.database,
    schema: req.context.schema,
    logger: req.context.logger,
    emitter: req.context.emitter,
  };
}
