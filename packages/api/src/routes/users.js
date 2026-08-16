import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function usersService(req) {
  const Service = req.context.services.UsersService;
  return new Service(serviceOptionsFromRequest(req));
}

function notFound(id) {
  const error = new Error(`User not found: ${id}`);
  error.code = 'USER_NOT_FOUND';
  return error;
}

export function createUsersRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    res.json({ data: await usersService(req).readMany() });
  });

  router.post('/', async (req, res) => {
    const data = await usersService(req).createOne(req.body ?? {});
    res.status(201).json({ data });
  });

  router.get('/:id', async (req, res) => {
    const data = await usersService(req).readOne(req.params.id);
    if (!data) throw notFound(req.params.id);
    res.json({ data });
  });

  router.patch('/:id', async (req, res) => {
    const data = await usersService(req).updateOne(req.params.id, req.body ?? {});
    res.json({ data });
  });

  router.patch('/:id/password', async (req, res) => {
    await usersService(req).updatePassword(req.params.id, req.body?.password);
    res.status(204).end();
  });

  router.delete('/:id', async (req, res) => {
    await usersService(req).deleteOne(req.params.id);
    res.status(204).end();
  });

  return router;
}
