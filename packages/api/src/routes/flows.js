import express from 'express';
import { serviceOptionsFromRequest } from '../service-options.js';

export function createFlowsRouter(options = {}) {
  const router = express.Router();
  const service = req => new req.context.services.FlowsService({ ...serviceOptionsFromRequest(req), services: req.context.services, ...options });
  router.get('/', async (req, res) => res.json({ data: await service(req).readMany() }));
  router.get('/configuration', async (req, res) => res.json({ data: await service(req).configuration() }));
  router.get('/available', async (req, res) => res.json({ data: await service(req).availableManual(req.query.collection ?? null) }));
  router.post('/', async (req, res) => res.status(201).json({ data: await service(req).save(req.body) }));
  for (const method of ['get', 'post']) router[method]('/trigger/:id', async (req, res) => {
    res.json({ data: await service(req).runWebhook(req.params.id, { body: req.body ?? {}, query: req.query }, req.method) });
  });
  router.get('/:id', async (req, res) => res.json({ data: await service(req).readOne(req.params.id) }));
  router.put('/:id', async (req, res) => res.json({ data: await service(req).save(req.body, req.params.id) }));
  router.delete('/:id', async (req, res) => {
    const revision = typeof req.query.revision === 'string' && /^\d+$/.test(req.query.revision) ? Number(req.query.revision) : null;
    await service(req).deleteOne(req.params.id, revision); res.status(204).end();
  });
  router.get('/:id/runs', async (req, res) => res.json({ data: await service(req).readRuns(req.params.id) }));
  router.post('/:id/run', async (req, res) => res.json({ data: await service(req).runManual(req.params.id, req.body ?? {}) }));
  return router;
}
