import express from 'express';
import { AiAutomationsService } from '../automations/service.js';

export function automationServiceFromRequest(req, options = {}) {
  return new AiAutomationsService({ database: req.context.database, accountability: req.accountability,
    services: req.context.services, emitter: req.context.emitter, storage: req.context.storage,
    logger: req.context.logger, ...options });
}

export function createAutomationsRouter(options) {
  const router = express.Router();
  const service = (req) => automationServiceFromRequest(req, options);
  router.get('/', async (req, res) => res.json({ data: await service(req).list() }));
  router.get('/configuration', async (req, res) => res.json({ data: await service(req).configuration() }));
  router.post('/', async (req, res) => res.status(201).json({ data: await service(req).save(req.body) }));
  router.put('/:id', async (req, res) => res.json({ data: await service(req).save(req.body, req.params.id) }));
  router.delete('/:id', async (req, res) => { await service(req).remove(req.params.id); res.status(204).end(); });
  router.get('/:id/runs', async (req, res) => res.json({ data: await service(req).runs(req.params.id) }));
  router.post('/runs/:id/retry', async (req, res) => res.json({ data: await service(req).retry(req.params.id) }));
  router.post('/preview', async (req, res) => res.json({ data: await service(req).preview(req.body?.rule, req.body?.item_key) }));
  return router;
}
