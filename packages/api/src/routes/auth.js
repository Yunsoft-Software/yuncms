import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function authService(req) {
  const Service = req.context.services.AuthService;
  return new Service(serviceOptionsFromRequest(req));
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
    if (!req.authToken) {
      const error = new Error('Authenticated access token is required');
      error.code = 'UNAUTHORIZED';
      throw error;
    }
    await authService(req).logout(req.authToken);
    res.status(204).end();
  });

  router.post('/logout-all', async (req, res) => {
    await authService(req).logoutAll();
    res.status(204).end();
  });

  return router;
}
