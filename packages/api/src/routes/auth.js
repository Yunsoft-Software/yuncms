import express from 'express';

import { createFixedWindowRateLimit } from '../rate-limit.js';
import { serviceOptionsFromRequest } from '../service-options.js';

function service(req, name) {
  const Service = req.context.services[name];
  return new Service(serviceOptionsFromRequest(req));
}

function authService(req) {
  return service(req, 'AuthService');
}

function authTokensService(req) {
  return service(req, 'AuthTokensService');
}

function apiTokensService(req) {
  return service(req, 'ApiTokensService');
}

function usersService(req) {
  return service(req, 'UsersService');
}

function requireSessionAuthentication(req) {
  if (req.authMethod !== 'session' || !req.authToken) {
    const error = new Error('Session access token is required');
    error.code = 'UNAUTHORIZED';
    throw error;
  }
}

function requireMailer(mailer) {
  if (mailer) return mailer;
  const error = new Error('SMTP mail delivery is not configured');
  error.code = 'MAIL_NOT_CONFIGURED';
  throw error;
}

function actionUrl(config, action, token) {
  return `${config.auth.publicUrl}/?auth_action=${encodeURIComponent(action)}&token=${encodeURIComponent(token)}`;
}

function noStore(req, res, next) {
  res.set('cache-control', 'no-store');
  res.set('pragma', 'no-cache');
  next();
}

export function createAuthRouter({ mailer = null, config = null, logger = console } = {}) {
  const router = express.Router();
  const limits = config?.auth?.rateLimit ?? {};
  const loginLimit = createFixedWindowRateLimit({
    windowMs: limits.loginWindowMs ?? 60_000,
    max: limits.loginMax ?? 10,
  });
  const refreshLimit = createFixedWindowRateLimit({
    windowMs: limits.refreshWindowMs ?? 60_000,
    max: limits.refreshMax ?? 30,
  });
  const actionLimit = createFixedWindowRateLimit({
    windowMs: limits.actionWindowMs ?? 15 * 60_000,
    max: limits.actionMax ?? 5,
  });

  router.use(noStore);

  router.post('/login', loginLimit, async (req, res) => {
    const result = await authService(req).login({
      email: req.body?.email,
      password: req.body?.password,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json({ data: result });
  });

  router.post('/refresh', refreshLimit, async (req, res) => {
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

  router.post('/password-reset/request', actionLimit, async (req, res) => {
    const transport = requireMailer(mailer);
    const result = await authTokensService(req).requestPasswordReset(req.body?.email);

    if (result) {
      try {
        const url = actionUrl(config, 'reset', result.token);
        await transport.send({
          to: String(req.body.email).trim(),
          subject: 'Reset your YunCMS password',
          text: `A password reset was requested for your YunCMS account.\n\nOpen this link to choose a new password:\n${url}\n\nIf you did not request this, you can ignore this message.`,
        });
      } catch (error) {
        logger.error?.('YunCMS password reset mail delivery failed', {
          requestId: req.id,
          code: error?.code,
          message: error?.message,
        });
      }
    }

    res.status(202).json({ data: { accepted: true } });
  });

  router.post('/password-reset/confirm', actionLimit, async (req, res) => {
    await authTokensService(req).resetPassword(req.body?.token, req.body?.password);
    res.status(204).end();
  });

  router.post('/email-verification/request', actionLimit, async (req, res) => {
    const transport = requireMailer(mailer);
    if (!req.accountability?.user) {
      const error = new Error('Authentication is required to request email verification');
      error.code = 'UNAUTHORIZED';
      throw error;
    }

    const userId = req.body?.user ?? req.accountability.user;
    const user = await usersService(req).readOne(userId);
    if (!user) {
      const error = new Error(`User not found: ${userId}`);
      error.code = 'USER_NOT_FOUND';
      throw error;
    }
    const result = await authTokensService(req).createEmailVerification(userId);
    const url = actionUrl(config, 'verify', result.token);
    await transport.send({
      to: user.email,
      subject: 'Verify your YunCMS email',
      text: `Verify your YunCMS email address by opening this link:\n${url}\n\nIf you did not request this, you can ignore this message.`,
    });
    res.status(202).json({ data: { accepted: true } });
  });

  router.post('/email-verification/confirm', actionLimit, async (req, res) => {
    await authTokensService(req).verifyEmail(req.body?.token);
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

export { actionUrl, noStore, requireMailer, requireSessionAuthentication };
