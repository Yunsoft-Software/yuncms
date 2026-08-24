import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function navigationService(req) {
  const Service = req.context.services.NavigationGroupsService;
  return new Service(serviceOptionsFromRequest(req));
}

function requireStudioUser(req) {
  if (req?.authMethod !== 'public' && req?.accountability?.user) return;
  const error = new Error('Studio navigation requires an authenticated YunCMS account');
  error.code = 'UNAUTHORIZED';
  throw error;
}

export function createStudioNavigationRouter() {
  const router = express.Router();

  router.get('/groups', async (req, res, next) => {
    try {
      requireStudioUser(req);
      return res.json({ data: await navigationService(req).readMany(), request_id: req.id });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/groups', async (req, res, next) => {
    try {
      requireStudioUser(req);
      return res.status(201).json({ data: await navigationService(req).createOne(req.body ?? {}), request_id: req.id });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/groups/:id', async (req, res, next) => {
    try {
      requireStudioUser(req);
      return res.json({ data: await navigationService(req).updateOne(req.params.id, req.body ?? {}), request_id: req.id });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/groups/:id', async (req, res, next) => {
    try {
      requireStudioUser(req);
      return res.json({ data: await navigationService(req).deleteOne(req.params.id), request_id: req.id });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export { requireStudioUser };
