import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function authService(req) {
  const Service = req.context.services.AuthService;
  return new Service(serviceOptionsFromRequest(req));
}

function apiTokensService(req) {
  const Service = req.context.services.ApiTokensService;
  return new Service(serviceOptionsFromRequest(req));
}

function requireSessionAuthentication(req) {
  if (req.authMethod !== 'session' || !req.authToken) {
    const error = new Error('Session access token is required');
    error.code = 'UNAUTHORIZED';
    throw error;
  }
}

export function createAuthRouter() {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const result = await authService(req).login({
      email: req.body?.email,
      password: req.body?.password,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json({ data: result });
  });

  router.post('/refresh', async (req, res) => {
    const result = await authService(req).refresh(req.body?.refresh_token);
    res.json({ data: result });
  });

  router.post('/logout', async (req, res) => {
    requireSessionAuthentication(req);
    await authService(req).logout(req.authToken);
    res.status(204).end();
  });

  router.post('/logout-all', async (req, res) => {
    requireSessionAuthentication(req);
    await authService(req).logoutAll();
    res.status(204).end();
  });

  router.get('/tokens', async (req, res) => {
    const data = await apiTokensService(req).readMany();
    res.json({ data });
  });

  router.post('/tokens', async (req, res) => {
    const data = await apiTokensService(req).createOne(req.body ?? {});
    res.status(201).json({ data });
  });

  router.delete('/tokens/:id', async (req, res) => {
    const deleted = await apiTokensService(req).deleteOne(req.params.id);
    if (!deleted) {
      const error = new Error('API token not found');
      error.code = 'NOT_FOUND';
      throw error;
    }
    res.status(204).end();
  });

  return router;
}

export { requireSessionAuthentication };
