import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function navigationService(req) {
  const Service = req.context.services.NavigationGroupsService;
  return new Service(serviceOptionsFromRequest(req));
}

export function createStudioNavigationRouter() {
  const router = express.Router();

  router.get('/groups', async (req, res, next) => {
    try {
      return res.json({ data: await navigationService(req).readMany(), request_id: req.id });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/groups', async (req, res, next) => {
    try {
      return res.status(201).json({ data: await navigationService(req).createOne(req.body ?? {}), request_id: req.id });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/groups/:id', async (req, res, next) => {
    try {
      return res.json({ data: await navigationService(req).updateOne(req.params.id, req.body ?? {}), request_id: req.id });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/groups/:id', async (req, res, next) => {
    try {
      return res.json({ data: await navigationService(req).deleteOne(req.params.id), request_id: req.id });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
