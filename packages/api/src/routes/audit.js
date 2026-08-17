import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function auditService(req) {
  const Service = req.context.services.AuditService;
  return new Service(serviceOptionsFromRequest(req));
}

function integerQuery(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    const error = new Error('Invalid audit pagination value');
    error.code = 'INVALID_QUERY';
    throw error;
  }
  return parsed;
}

export function createAuditRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const data = await auditService(req).readMany({
      limit: integerQuery(req.query.limit, 100, { min: 1, max: 500 }),
      offset: integerQuery(req.query.offset, 0, { min: 0 }),
      collection: req.query.collection || null,
      user: req.query.user || null,
    });
    res.json({ data });
  });

  router.post('/cleanup', async (req, res) => {
    const defaults = req.context.env?.audit ?? {};
    const data = await auditService(req).cleanup({
      retentionDays: req.body?.retentionDays ?? defaults.retentionDays,
      batchSize: req.body?.batchSize ?? defaults.cleanupBatchSize,
      maxBatches: req.body?.maxBatches ?? defaults.cleanupMaxBatches,
    });
    res.json({ data });
  });

  return router;
}
