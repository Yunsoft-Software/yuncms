import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function settingsService(req) {
  const Service = req.context.services.StudioSettingsService;
  return new Service(serviceOptionsFromRequest(req));
}

export function createStudioSettingsRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    res.json({ data: await settingsService(req).readPublic() });
  });

  router.patch('/', async (req, res) => {
    res.json({ data: await settingsService(req).updateOne(req.body ?? {}) });
  });

  return router;
}
