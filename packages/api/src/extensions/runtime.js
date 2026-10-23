import { pathToFileURL } from 'node:url';
import express from 'express';
import { activeAdvisoryLockConnection } from '@yunsoft/yuncms-core';

import { discoverExtensions } from './discovery.js';
import { ExtensionScheduler, resolveExtensionAuthConfig } from './scheduler.js';
import { resolveServiceOptionsInput } from '../service-options.js';

function extensionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertDefinition(definition, manifest) {
  if (!definition || definition.__yuncms_extension__ !== true || typeof definition.register !== 'function') {
    throw extensionError(
      'INVALID_EXTENSION_DEFINITION',
      `Extension ${manifest.id} must default-export a YunCMS extension definition`,
    );
  }
  if (definition.type !== manifest.type) {
    throw extensionError(
      'EXTENSION_TYPE_MISMATCH',
      `Extension ${manifest.id} manifest type ${manifest.type} does not match definition type ${definition.type}`,
    );
  }
  return definition;
}

async function importExtension(manifest) {
  const moduleUrl = pathToFileURL(manifest.entry).href;
  const imported = await import(moduleUrl);
  return assertDefinition(imported.default, manifest);
}

function buildServiceOptionsResolver({
  defaultDatabase,
  schemaCache,
  logger,
  emitter,
  storage,
  resolvedAuthConfig,
  defaultAccountability = undefined,
  defaultRequestId = null,
}) {
  return async (first = null, second = null) => {
    const { req, overrides: extra } = resolveServiceOptionsInput(first, second);
    const resolvedDatabase = extra.database
      ?? activeAdvisoryLockConnection(req?.context?.database ?? defaultDatabase);
    const resolvedSchema = extra.schema
      ?? req?.context?.schema
      ?? await schemaCache.get(resolvedDatabase);
    return {
      accountability: req?.accountability ?? defaultAccountability,
      database: resolvedDatabase,
      schema: resolvedSchema,
      logger,
      emitter,
      storage,
      permissionCache: req?.context?.permissionCache ?? new Map(),
      requestId: req?.id ?? defaultRequestId,
      authConfig: req?.context?.env?.auth ?? resolvedAuthConfig,
      ...extra,
      database: resolvedDatabase,
      schema: resolvedSchema,
    };
  };
}

function createBaseContext({ services, database, schemaCache, emitter, storage, logger, env, authConfig }) {
  const resolvedAuthConfig = resolveExtensionAuthConfig(authConfig, env);
  return Object.freeze({
    services,
    database,
    pool: database,
    logger,
    env,
    authConfig: resolvedAuthConfig,
    emitter,
    storage,
    getSchema: (db) => schemaCache.get(db ?? activeAdvisoryLockConnection(database)),
    getAccountability: (req) => req?.accountability ?? null,
    serviceOptions: buildServiceOptionsResolver({
      defaultDatabase: database,
      schemaCache,
      logger,
      emitter,
      storage,
      resolvedAuthConfig,
    }),
  });
}

function createHookEventContext(baseContext, eventContext, schemaCache) {
  const activeDatabase = eventContext?.database ?? baseContext.database;
  return {
    ...baseContext,
    ...eventContext,
    database: activeDatabase,
    pool: baseContext.pool ?? baseContext.database,
    getSchema: (db) => schemaCache.get(db ?? activeAdvisoryLockConnection(activeDatabase)),
    serviceOptions: buildServiceOptionsResolver({
      defaultDatabase: activeDatabase,
      schemaCache,
      logger: baseContext.logger,
      emitter: baseContext.emitter,
      storage: baseContext.storage,
      resolvedAuthConfig: baseContext.authConfig,
      defaultAccountability: eventContext?.accountability,
      defaultRequestId: eventContext?.requestId ?? null,
    }),
  };
}

function hookRegistrationApi(emitter, baseContext, manifest, scheduler, schemaCache) {
  const registration = Object.freeze({
    extensionId: manifest.id,
    priority: Number.isInteger(manifest.priority) ? manifest.priority : 0,
  });

  return Object.freeze({
    filter(event, handler, options = {}) {
      return emitter.registerFilter(event, (payload, eventContext) =>
        handler(payload, createHookEventContext(baseContext, eventContext, schemaCache)), {
        ...registration,
        ...options,
        extensionId: manifest.id,
      });
    },
    action(event, handler, options = {}) {
      return emitter.registerAction(event, (payload, eventContext) =>
        handler(payload, createHookEventContext(baseContext, eventContext, schemaCache)), {
        ...registration,
        ...options,
        extensionId: manifest.id,
      });
    },
    init(event, handler, options = {}) {
      return emitter.registerInit(event, (eventContext) =>
        handler(createHookEventContext(baseContext, eventContext, schemaCache)), {
        ...registration,
        ...options,
        extensionId: manifest.id,
      });
    },
    schedule(expression, handler, options = {}) {
      return scheduler.register(manifest.id, expression, handler, options);
    },
  });
}

export async function loadExtensionRuntime({
  rootDir = process.cwd(),
  localDirectory = 'extensions',
  includeDependencies = true,
  services,
  database,
  schemaCache,
  emitter,
  storage = null,
  logger = console,
  env,
  authConfig,
} = {}) {
  if (!services || !database || !schemaCache || !emitter) {
    throw new Error('Extension runtime requires services, database, schemaCache and emitter');
  }

  const manifests = await discoverExtensions({ rootDir, localDirectory, includeDependencies });
  const baseContext = createBaseContext({ services, database, schemaCache, emitter, storage, logger, env, authConfig });
  const scheduler = new ExtensionScheduler({
    database,
    services,
    schemaCache,
    emitter,
    storage,
    logger,
    env,
    authConfig: baseContext.authConfig,
  });
  const endpointExtensions = [];

  for (const manifest of manifests) {
    const definition = await importExtension(manifest);

    if (manifest.type === 'hook') {
      await definition.register(hookRegistrationApi(emitter, baseContext, manifest, scheduler, schemaCache), baseContext);
      logger.info?.(`Loaded YunCMS hook extension: ${manifest.id}`);
      continue;
    }

    const router = express.Router();
    await definition.register(router, baseContext);
    endpointExtensions.push(Object.freeze({
      id: manifest.id,
      router,
      manifest,
    }));
    logger.info?.(`Loaded YunCMS endpoint extension: ${manifest.id}`);
  }

  return Object.freeze({
    manifests: Object.freeze(manifests),
    endpointExtensions: Object.freeze(endpointExtensions),
    async init(event) {
      await emitter.init(event, baseContext);
    },
    startSchedules() {
      scheduler.start();
    },
    async stopSchedules(options = {}) {
      return scheduler.stop(options);
    },
  });
}
