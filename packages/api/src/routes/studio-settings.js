import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function settingsService(req) {
  const Service = req.context.services.StudioSettingsService;
  return new Service(serviceOptionsFromRequest(req));
}

export function createStudioSettingsRouter() {
  const router = express.Router();

  router.get('/logo', async (req, res) => {
    const { file, contents } = await settingsService(req).readLogoContent();
    res.set('cache-control', 'public, max-age=300, must-revalidate');
    res.type(file.mimetype || 'application/octet-stream').send(contents);
  });

  router.get('/', async (req, res) => {
    res.json({ data: await settingsService(req).readPublic() });
  });

  router.patch('/', async (req, res) => {
    res.json({ data: await settingsService(req).updateOne(req.body ?? {}) });
  });

  return router;
}
