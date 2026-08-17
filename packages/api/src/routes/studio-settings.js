import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function settingsService(req) {
  const Service = req.context.services.StudioSettingsService;
  return new Service(serviceOptionsFromRequest(req));
}

function sendImageAsset(res, asset) {
  const { file, contents } = asset;
  res.set('cache-control', 'no-cache, must-revalidate');
  res.set('content-security-policy', 'sandbox');
  res.set('content-disposition', 'inline');
  return res.type(file.mimetype || 'application/octet-stream').send(contents);
}

export function createStudioSettingsRouter() {
  const router = express.Router();

  router.get('/logo', async (req, res) => {
    sendImageAsset(res, await settingsService(req).readLogoContent());
  });

  router.get('/favicon', async (req, res) => {
    sendImageAsset(res, await settingsService(req).readFaviconContent());
  });

  router.get('/', async (req, res) => {
    res.json({ data: await settingsService(req).readPublic() });
  });

  router.patch('/', async (req, res) => {
    res.json({ data: await settingsService(req).updateOne(req.body ?? {}) });
  });

  return router;
}
