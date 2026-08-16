import { pathToFileURL } from 'node:url';
import express from 'express';

import { discoverExtensions } from './discovery.js';

function extensionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertDefinition(definition, manifest) {
  if (!definition || definition.__yuncmsExtension !== true || typeof definition.register !== 'function') {
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

function createBaseContext({ services, database, schemaCache, emitter, logger, env }) {
  return Object.freeze({
    services,
    database,
    logger,
    env,
    emitter,
    getSchema: () => schemaCache.get(database),
    getAccountability: (req) => req?.accountability ?? null,
    serviceOptions: async (req) => ({
      accountability: req?.accountability,
      database,
      schema: req?.context?.schema ?? await schemaCache.get(database),
      logger,
      emitter,
    }),
  });
}

function hookRegistrationApi(emitter, baseContext) {
  return Object.freeze({
    filter(event, handler) {
      return emitter.registerFilter(event, (payload, eventContext) =>
        handler(payload, { ...baseContext, ...eventContext }));
    },
    action(event, handler) {
      return emitter.registerAction(event, (payload, eventContext) =>
        handler(payload, { ...baseContext, ...eventContext }));
    },
    init(event, handler) {
      return emitter.registerInit(event, (eventContext) =>
        handler({ ...baseContext, ...eventContext }));
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
  logger = console,
  env,
} = {}) {
  if (!services || !database || !schemaCache || !emitter) {
    throw new Error('Extension runtime requires services, database, schemaCache and emitter');
  }

  const manifests = await discoverExtensions({ rootDir, localDirectory, includeDependencies });
  const baseContext = createBaseContext({ services, database, schemaCache, emitter, logger, env });
  const endpointExtensions = [];
  const hookApi = hookRegistrationApi(emitter, baseContext);

  for (const manifest of manifests) {
    const definition = await importExtension(manifest);

    if (manifest.type === 'hook') {
      await definition.register(hookApi, baseContext);
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
