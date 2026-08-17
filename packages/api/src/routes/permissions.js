import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function permissionsService(req) {
  const Service = req.context.services.PermissionsService;
  return new Service(serviceOptionsFromRequest(req));
}

function notFound(id) {
  const error = new Error(`Permission not found: ${id}`);
  error.code = 'PERMISSION_NOT_FOUND';
  return error;
}

export function createPermissionsRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    res.json({ data: await permissionsService(req).readMany() });
  });

  router.post('/', async (req, res) => {
    const data = await permissionsService(req).createOne(req.body ?? {});
    res.status(201).json({ data });
  });

  router.get('/:id', async (req, res) => {
    const data = await permissionsService(req).readOne(req.params.id);
    if (!data) throw notFound(req.params.id);
    res.json({ data });
  });

  router.patch('/:id', async (req, res) => {
    const data = await permissionsService(req).updateOne(req.params.id, req.body ?? {});
    res.json({ data });
  });

  router.delete('/:id', async (req, res) => {
    await permissionsService(req).deleteOne(req.params.id);
    res.status(204).end();
  });

  return router;
}
