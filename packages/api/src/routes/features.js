import express from 'express';
import { serviceOptionsFromRequest } from '../service-options.js';

export function createFeaturesRouter() {
  const router = express.Router();
  const service = req => new req.context.services.FeaturesService(serviceOptionsFromRequest(req));
  router.get('/', async (req, res) => res.json({ data: await service(req).readStatus() }));
  router.patch('/:feature', async (req, res) => res.json({ data: await service(req).update(req.params.feature, req.body) }));
  router.post('/license', async (req, res) => res.json({ data: await service(req).activate(req.body?.token) }));
  return router;
}
