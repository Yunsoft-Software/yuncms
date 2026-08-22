import { pathToFileURL } from 'node:url';
import express from 'express';

import { discoverExtensions } from './discovery.js';

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

function createBaseContext({ services, database, schemaCache, emitter, storage, logger, env }) {
  return Object.freeze({
    services,
    database,
    logger,
    env,
    emitter,
    storage,
    getSchema: () => schemaCache.get(database),
    getAccountability: (req) => req?.accountability ?? null,
    serviceOptions: async (req) => ({
      accountability: req?.accountability,
      database,
      schema: req?.context?.schema ?? await schemaCache.get(database),
      logger,
      emitter,
      storage,
      permissionCache: req?.context?.permissionCache ?? new Map(),
      requestId: req?.id ?? null,
    }),
  });
}

function hookRegistrationApi(emitter, baseContext, manifest) {
  const registration = Object.freeze({
    extensionId: manifest.id,
    priority: Number.isInteger(manifest.priority) ? manifest.priority : 0,
  });

  return Object.freeze({
    filter(event, handler, options = {}) {
      return emitter.registerFilter(event, (payload, eventContext) =>
        handler(payload, { ...baseContext, ...eventContext }), {
        ...registration,
        ...options,
        extensionId: manifest.id,
      });
    },
    action(event, handler, options = {}) {
      return emitter.registerAction(event, (payload, eventContext) =>
        handler(payload, { ...baseContext, ...eventContext }), {
        ...registration,
        ...options,
        extensionId: manifest.id,
      });
    },
    init(event, handler, options = {}) {
      return emitter.registerInit(event, (eventContext) =>
        handler({ ...baseContext, ...eventContext }), {
        ...registration,
        ...options,
        extensionId: manifest.id,
      });
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
} = {}) {
  if (!services || !database || !schemaCache || !emitter) {
    throw new Error('Extension runtime requires services, database, schemaCache and emitter');
  }

  const manifests = await discoverExtensions({ rootDir, localDirectory, includeDependencies });
  const baseContext = createBaseContext({ services, database, schemaCache, emitter, storage, logger, env });
  const endpointExtensions = [];

  for (const manifest of manifests) {
    const definition = await importExtension(manifest);

    if (manifest.type === 'hook') {
      await definition.register(hookRegistrationApi(emitter, baseContext, manifest), baseContext);
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
  });
}
