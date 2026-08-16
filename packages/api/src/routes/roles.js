import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function rolesService(req) {
  const Service = req.context.services.RolesService;
  return new Service(serviceOptionsFromRequest(req));
}

function notFound(id) {
  const error = new Error(`Role not found: ${id}`);
  error.code = 'ROLE_NOT_FOUND';
  return error;
}

export function createRolesRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    res.json({ data: await rolesService(req).readMany() });
  });

  router.post('/', async (req, res) => {
    const data = await rolesService(req).createOne(req.body ?? {});
    res.status(201).json({ data });
  });

  router.get('/:id', async (req, res) => {
    const data = await rolesService(req).readOne(req.params.id);
    if (!data) throw notFound(req.params.id);
    res.json({ data });
  });

  router.patch('/:id', async (req, res) => {
    const data = await rolesService(req).updateOne(req.params.id, req.body ?? {});
    res.json({ data });
  });

  router.delete('/:id', async (req, res) => {
    await rolesService(req).deleteOne(req.params.id);
    res.status(204).end();
  });

  return router;
}
