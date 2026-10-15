import express from 'express';
import { serviceOptionsFromRequest } from '../service-options.js';

export function createFlowsRouter(options = {}) {
  const router = express.Router();
  const service = req => new req.context.services.FlowsService({ ...serviceOptionsFromRequest(req), services: req.context.services, ...options });
  router.get('/', async (req, res) => {
    const flows = service(req), data = await flows.readMany(req.query);
    res.json({ data, ...(req.query.meta === 'filter_count' ? { meta: { filter_count: await flows.count(req.query) } } : {}) });
  });
  router.get('/access', async (req, res) => res.json({ data: await service(req).access() }));
  router.post('/import', async (req, res) => {
    const flows = service(req); flows.requireManager();
    if (Object.keys(req.query).some(key => key !== 'preview')) throw Object.assign(new Error('Unsupported import option'), { code: 'INVALID_FLOW_QUERY', status: 400 });
    if (req.query.preview !== undefined && req.query.preview !== '1') throw Object.assign(new Error('Invalid import preview option'), { code: 'INVALID_FLOW_QUERY', status: 400 });
    const preview = req.query.preview === '1';
    res.status(preview ? 200 : 201).json({ data: await flows.importDefinition(req.body, { preview }) });
  });
  router.get('/configuration', async (req, res) => res.json({ data: await service(req).configuration() }));
  router.get('/available', async (req, res) => res.json({ data: await service(req).availableManual(req.query.collection ?? null) }));
  router.post('/', async (req, res) => res.status(201).json({ data: await service(req).save(req.body) }));
  for (const method of ['get', 'post']) router[method]('/trigger/:id', async (req, res) => {
    res.json({ data: await service(req).runWebhook(req.params.id, { body: req.body ?? {}, query: req.query }, req.method) });
  });
  router.get('/:id/export', async (req, res) => {
    const definition = await service(req).exportOne(req.params.id);
    const filename = (definition.name || 'flow').replace(/[^A-Za-z0-9_-]+/g, '-') + '.json';
    res.set('Content-Disposition', `attachment; filename="${filename}"`).type('application/json').send(JSON.stringify(definition, null, 2) + '\n');
  });
  router.get('/:id', async (req, res) => {
    const flows = service(req), data = await flows.readOne(req.params.id);
    res.json({ data, meta: { access: flows.accessFor(data) } });
  });
  router.put('/:id', async (req, res) => res.json({ data: await service(req).save(req.body, req.params.id) }));
  router.delete('/:id', async (req, res) => {
    const revision = typeof req.query.revision === 'string' && /^\d+$/.test(req.query.revision) ? Number(req.query.revision) : null;
    await service(req).deleteOne(req.params.id, revision); res.status(204).end();
  });
  router.get('/:id/runs', async (req, res) => {
    const flows = service(req), data = await flows.readRuns(req.params.id, req.query);
    res.json({ data, ...(req.query.meta === 'filter_count' ? { meta: { filter_count: await flows.countRuns(req.params.id, req.query) } } : {}) });
  });
  router.get('/:id/runs/:runId', async (req, res) => res.json({ data: await service(req).readRun(req.params.id, req.params.runId) }));
  router.post('/:id/run', async (req, res) => res.json({ data: await service(req).runManual(req.params.id, req.body ?? {}) }));
  return router;
}
