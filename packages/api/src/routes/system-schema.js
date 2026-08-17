import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function service(req, name) {
  const Service = req.context.services[name];
  if (!Service) throw new Error(`Service is not registered: ${name}`);
  return new Service(serviceOptionsFromRequest(req));
}

export function createSystemSchemaRouter({ schemaCache = null } = {}) {
  const router = express.Router();

  router.post('/system-collections/:collection/fields', async (req, res) => {
    const data = await service(req, 'SystemCollectionFieldsService').createOne(
      req.params.collection,
      req.body ?? {},
    );
    schemaCache?.clear();
    try {
      await service(req, 'AuditService').record({
        action: 'schema.system-field.create',
        collection: req.params.collection,
        itemKey: data.field,
        requestId: req.id,
        payload: { after: data },
      });
    } catch (error) {
      req.context.logger?.error?.('YunCMS system field audit write failed after committed mutation', {
        requestId: req.id,
        collection: req.params.collection,
        field: data.field,
        code: error?.code,
        message: error?.message,
      });
    }
    res.status(201).json({ data });
  });

  return router;
}
