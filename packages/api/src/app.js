import { randomUUID } from 'node:crypto';
import express from 'express';
import {
  createCoreServiceRegistry,
  pingDatabase,
} from '@yunsoft/yuncms-core';

import { createAuthenticationMiddleware } from './authentication.js';
import { apiErrorHandler } from './error-response.js';
import { createAuditRouter } from './routes/audit.js';
import { createAuthRouter } from './routes/auth.js';
import { createFilesRouter } from './routes/files.js';
import { createItemsRouter } from './routes/items.js';
import { createPermissionsRouter } from './routes/permissions.js';
import { createRolesRouter } from './routes/roles.js';
import { createSchemaRouter } from './routes/schema.js';
import { createUsersRouter } from './routes/users.js';
import { createStudioMiddleware } from './studio.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

function securityHeaders(req, res, next) {
  res.set('x-content-type-options', 'nosniff');
  res.set('x-frame-options', 'DENY');
  res.set('referrer-policy', 'no-referrer');
  res.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.set('cross-origin-resource-policy', 'same-origin');
  next();
}

function studioCors(config) {
  return (req, res, next) => {
    const origin = req.get('origin');
    const allowedOrigin = config?.server?.studioOrigin;

    if (origin && allowedOrigin && origin === allowedOrigin) {
      res.set('access-control-allow-origin', origin);
      res.set('vary', 'Origin');
      res.set('access-control-allow-headers', 'content-type, authorization, x-request-id, x-filename, x-title, x-mimetype');
      res.set('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    }

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  };
}

function requestIdentity(req, res, next) {
  const supplied = req.get('x-request-id');
  req.id = supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
  res.set('x-request-id', req.id);
  next();
}

export function createApp({
  pool,
  config,
  logger = console,
  serviceRegistry = createCoreServiceRegistry(),
  schemaCache = null,
  emitter = null,
  storage = null,
  mailer = null,
  endpointExtensions = [],
  studioRoot = undefined,
}) {
  if (!pool) throw new Error('Database pool is required');
  if (!config) throw new Error('Config is required');
  if (!Array.isArray(endpointExtensions)) throw new Error('endpointExtensions must be an array');

  const services = serviceRegistry.toObject();
  const app = express();
  app.disable('x-powered-by');
  if (config.server?.trustProxyHops > 0) app.set('trust proxy', config.server.trustProxyHops);
  app.use(securityHeaders);
  app.use(studioCors(config));
  app.use(requestIdentity);
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', request_id: req.id });
  });

  app.get('/ready', async (req, res) => {
    try {
      const ready = await pingDatabase(pool);
      if (!ready) throw new Error('Database ping returned an unexpected result');
      res.json({ status: 'ready', request_id: req.id });
    } catch (error) {
      logger.warn?.('YunCMS readiness check failed', { requestId: req.id, error });
      res.status(503).json({
        status: 'not_ready',
        request_id: req.id,
        errors: [{ code: 'DATABASE_UNAVAILABLE', message: 'Database is not ready' }],
      });
    }
  });

  app.use(createStudioMiddleware({ root: studioRoot }));

  app.use(createAuthenticationMiddleware({
    pool,
    config,
    logger,
    services,
    schemaCache,
    emitter,
    storage,
  }));
  app.use('/auth', createAuthRouter({ mailer, config, logger }));
  app.use('/items', createItemsRouter());
  app.use('/schema', createSchemaRouter());
  app.use('/users', createUsersRouter());
  app.use('/roles', createRolesRouter());
  app.use('/permissions', createPermissionsRouter());
  app.use('/files', createFilesRouter({ maxUploadBytes: config.storage?.maxUploadBytes }));
  app.use('/audit', createAuditRouter());

  for (const extension of endpointExtensions) {
    if (!extension?.id || !extension?.router) {
      throw new Error('Invalid endpoint extension runtime entry');
    }
    app.use(`/extensions/${encodeURIComponent(extension.id)}`, extension.router);
  }

  app.use((req, res) => {
    res.status(404).json({
      errors: [{ code: 'NOT_FOUND', message: 'Route not found', request_id: req.id }],
    });
  });

  app.use(apiErrorHandler(logger));
  return app;
}

export { requestIdentity, securityHeaders, studioCors };
