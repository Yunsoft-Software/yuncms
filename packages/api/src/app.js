import { randomUUID } from 'node:crypto';
import express from 'express';
import {
  createCoreServiceRegistry,
  pingDatabase,
} from '@yuncms/core';

import { createAuthenticationMiddleware } from './authentication.js';
import { apiErrorHandler } from './error-response.js';
import { createAuthRouter } from './routes/auth.js';
import { createItemsRouter } from './routes/items.js';
import { createSchemaRouter } from './routes/schema.js';

function studioCors(config) {
  return (req, res, next) => {
    const origin = req.get('origin');
    const allowedOrigin = config?.server?.studioOrigin;

    if (origin && allowedOrigin && origin === allowedOrigin) {
      res.set('access-control-allow-origin', origin);
      res.set('vary', 'Origin');
      res.set('access-control-allow-headers', 'content-type, authorization, x-request-id');
      res.set('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    }

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  };
}

export function createApp({
  pool,
  config,
  logger = console,
  serviceRegistry = createCoreServiceRegistry(),
  schemaCache = null,
  emitter = null,
  endpointExtensions = [],
}) {
  if (!pool) throw new Error('Database pool is required');
  if (!config) throw new Error('Config is required');
  if (!Array.isArray(endpointExtensions)) throw new Error('endpointExtensions must be an array');

  const services = serviceRegistry.toObject();
  const app = express();
  app.disable('x-powered-by');
  app.use(studioCors(config));
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    req.id = req.get('x-request-id') || randomUUID();
    res.set('x-request-id', req.id);
    next();
  });

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

  app.use(createAuthenticationMiddleware({
    pool,
    config,
    logger,
    services,
    schemaCache,
    emitter,
  }));
  app.use('/auth', createAuthRouter());
  app.use('/items', createItemsRouter());
  app.use('/schema', createSchemaRouter());

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
