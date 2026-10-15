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
  const schemaService = req => new req.context.services.StudioSchemaService(serviceOptionsFromRequest(req));
  router.get('/collections', async (req, res) => { requireStudioUser(req); res.json({ data: await schemaService(req).readCollections() }); });
  router.get('/collections/:collection/fields', async (req, res) => { requireStudioUser(req); res.json({ data: await schemaService(req).readFields(req.params.collection) }); });
  router.get('/collections/:collection/capabilities', async (req, res) => {
    requireStudioUser(req);
    if (Object.keys(req.query).some(key => key !== 'ids')) throw Object.assign(new Error('Unsupported capability query option'), { code: 'INVALID_QUERY' });
    let ids = [];
    try { if (req.query.ids !== undefined) { if (typeof req.query.ids !== 'string') throw Error(); ids = JSON.parse(req.query.ids); } }
    catch { throw Object.assign(new Error('ids must be a JSON array'), { code: 'INVALID_QUERY' }); }
    res.json({ data: await schemaService(req).readCapabilities(req.params.collection, ids) });
  });
  router.get('/relations', async (req, res) => { requireStudioUser(req); res.json({ data: await schemaService(req).readRelations() }); });

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
