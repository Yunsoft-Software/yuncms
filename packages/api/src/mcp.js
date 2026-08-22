import express from 'express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer } from '@modelcontextprotocol/server';
import {
  readManyWithRelations,
  readOneWithRelations,
} from '@yunsoft/yuncms-core';
import * as z from 'zod/v4';

import { serviceOptionsFromRequest } from './service-options.js';

const READ_TOOL_NAMES = Object.freeze([
  'schema.list_collections',
  'schema.describe_collection',
  'items.read_many',
  'items.read_one',
]);
const WRITE_TOOL_NAMES = Object.freeze([
  'items.create',
  'items.update',
  'items.delete',
]);
const SAFE_TOOL_ERROR_CODES = new Set([
  'FORBIDDEN',
  'FORBIDDEN_FIELD',
  'COLLECTION_NOT_FOUND',
  'INVALID_QUERY',
  'QUERY_COST_LIMIT',
  'QUERY_RELATION_DEPTH_LIMIT',
  'INVALID_PAYLOAD',
  'REQUIRED_FIELD_MISSING',
  'FIELD_READ_ONLY',
  'FILTER_REQUIRED',
  'VALIDATION_FAILED',
  'VALIDATION_BULK_LIMIT',
]);

const collectionSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const delimitedSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).max(100),
]);
const filterSchema = z.record(z.string(), z.unknown());
const aggregateSchema = z.record(
  z.string(),
  z.union([z.string().min(1), z.array(z.string().min(1)).max(20)]),
);

function mcpError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeToolError(error) {
  const code = SAFE_TOOL_ERROR_CODES.has(error?.code) ? error.code : 'INTERNAL_ERROR';
  return {
    code,
    message: code === 'INTERNAL_ERROR' ? 'Tool execution failed' : String(error?.message ?? 'Request failed'),
    ...(code !== 'INTERNAL_ERROR' && error?.path ? { path: error.path } : {}),
  };
}

export function createToolResult(data, maxResultBytes = 1_000_000) {
  const payload = { data };
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text, 'utf8') > maxResultBytes) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: {
            code: 'MCP_RESULT_TOO_LARGE',
            message: `MCP result exceeds the configured ${maxResultBytes} byte limit`,
          },
        }),
      }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text', text }],
    structuredContent: payload,
  };
}

function toolHandler(handler, maxResultBytes) {
  return async (args) => {
    try {
      return createToolResult(await handler(args), maxResultBytes);
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: safeToolError(error) }) }],
        isError: true,
      };
    }
  };
}

function permissionService(req) {
  const Service = req.context.services.PermissionsService;
  return new Service(serviceOptionsFromRequest(req));
}

function itemService(req, collection) {
  const Service = req.context.services.ItemsService;
  return new Service(collection, serviceOptionsFromRequest(req));
}

async function actionAllowed(permissions, action, collection) {
  try {
    await permissions.resolve(action, collection);
    return true;
  } catch (error) {
    if (error?.code === 'FORBIDDEN') return false;
    throw error;
  }
}

export async function listReadableCollections(req, { maxItems = 100 } = {}) {
  const snapshot = req.context.schema;
  const candidates = Object.values(snapshot?.collections ?? {})
    .filter((collection) => !collection.system)
    .sort((left, right) => left.collection.localeCompare(right.collection));
  const permissions = permissionService(req);
  const visible = [];

  for (const collection of candidates) {
    if (visible.length >= maxItems) break;
    if (!await actionAllowed(permissions, 'read', collection.collection)) continue;
    visible.push({
      collection: collection.collection,
      name: collection.name ?? collection.collection,
      primary_key: collection.primary_key,
    });
  }
  return visible;
}

export async function describeReadableCollection(req, collection) {
  const snapshot = req.context.schema;
  const schema = snapshot?.collections?.[collection];
  if (!schema || schema.system) throw mcpError('COLLECTION_NOT_FOUND', `Unknown collection: ${collection}`);

  const permissions = permissionService(req);
  const readPermission = await permissions.resolve('read', collection);
  const visibleFields = readPermission.fields == null
    ? Object.keys(schema.fields ?? {})
    : readPermission.fields.filter((field) => schema.fields?.[field]);
  const fields = visibleFields.map((field) => {
    const metadata = schema.fields[field];
    const relation = snapshot.relationByManyField?.get(`${collection}.${field}`) ?? null;
    return {
      field,
      name: metadata.name ?? field,
      type: metadata.type,
      required: Boolean(metadata.required),
      readonly: Boolean(metadata.readonly),
      ...(relation ? {
        relation: {
          collection: relation.one_collection,
          field: relation.one_field ?? snapshot.collections?.[relation.one_collection]?.primary_key ?? 'id',
        },
      } : {}),
    };
  });

  return {
    collection,
    name: schema.name ?? collection,
    primary_key: schema.primary_key,
    capabilities: {
      read: true,
      create: await actionAllowed(permissions, 'create', collection),
      update: await actionAllowed(permissions, 'update', collection),
      delete: await actionAllowed(permissions, 'delete', collection),
    },
    fields,
  };
}

function readManyInput(maxItems) {
  return z.object({
    collection: collectionSchema,
    fields: delimitedSchema.optional(),
    expand: delimitedSchema.optional(),
    filter: filterSchema.optional(),
    search: z.string().max(200).optional(),
    sort: delimitedSchema.optional(),
    aggregate: aggregateSchema.optional(),
    groupBy: delimitedSchema.optional(),
    limit: z.number().int().min(1).max(maxItems).optional(),
    offset: z.number().int().min(0).max(1_000_000).optional(),
  });
}

export function registerMcpTools(server, req, {
  writesEnabled = false,
  maxItems = 100,
  maxResultBytes = 1_000_000,
} = {}) {
  const wrap = (handler) => toolHandler(handler, maxResultBytes);

  server.registerTool('schema.list_collections', {
    title: 'List readable YunCMS collections',
    description: 'List non-system collections the current YunCMS identity may read.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, wrap(async () => ({ collections: await listReadableCollections(req, { maxItems }) })));

  server.registerTool('schema.describe_collection', {
    title: 'Describe a YunCMS collection',
    description: 'Describe fields, direct relations and allowed CRUD actions for a readable collection.',
    inputSchema: z.object({ collection: collectionSchema }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, wrap(async ({ collection }) => describeReadableCollection(req, collection)));

  server.registerTool('items.read_many', {
    title: 'Read YunCMS items',
    description: 'Read items with YunCMS filters, search, sorting, aggregates and relation-aware fields. All normal RBAC and query-cost limits apply.',
    inputSchema: readManyInput(maxItems),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, wrap(async ({ collection, ...query }) => readManyWithRelations({
    collection,
    query: {
      ...query,
      limit: query.limit ?? Math.min(100, maxItems),
    },
    options: serviceOptionsFromRequest(req),
    ItemsServiceClass: req.context.services.ItemsService,
  })));

  server.registerTool('items.read_one', {
    title: 'Read one YunCMS item',
    description: 'Read one item by id with relation-aware field selection. Normal read permissions apply.',
    inputSchema: z.object({
      collection: collectionSchema,
      id: z.string().min(1).max(191),
      fields: delimitedSchema.optional(),
      expand: delimitedSchema.optional(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, wrap(async ({ collection, id, fields, expand }) => readOneWithRelations({
    collection,
    id,
    query: { ...(fields ? { fields } : {}), ...(expand ? { expand } : {}) },
    options: serviceOptionsFromRequest(req),
    ItemsServiceClass: req.context.services.ItemsService,
  })));

  if (!writesEnabled) return server;

  server.registerTool('items.create', {
    title: 'Create a YunCMS item',
    description: 'Create one item through ItemsService. Create field permissions, validation and hooks apply.',
    inputSchema: z.object({
      collection: collectionSchema,
      data: z.record(z.string(), z.unknown()),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, wrap(async ({ collection, data }) => itemService(req, collection).createOne(data)));

  server.registerTool('items.update', {
    title: 'Update a YunCMS item',
    description: 'Update one item by id through ItemsService. Update field permissions, validation and hooks apply.',
    inputSchema: z.object({
      collection: collectionSchema,
      id: z.string().min(1).max(191),
      data: z.record(z.string(), z.unknown()),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, wrap(async ({ collection, id, data }) => itemService(req, collection).updateOne(id, data)));

  server.registerTool('items.delete', {
    title: 'Delete a YunCMS item',
    description: 'Delete one item by id through ItemsService. Delete permissions and hooks apply.',
    inputSchema: z.object({
      collection: collectionSchema,
      id: z.string().min(1).max(191),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, wrap(async ({ collection, id }) => ({
    deleted: await itemService(req, collection).deleteOne(id),
  })));

  return server;
}

export function createRequestMcpServer(req, mcpConfig = {}) {
  const server = new McpServer(
    { name: 'yuncms', version: '0.1.5' },
    {
      instructions: mcpConfig.writesEnabled
        ? 'Use schema tools before item tools when the collection shape is unknown. YunCMS RBAC applies to every tool call.'
        : 'This YunCMS MCP endpoint is read-only. Use schema tools before item tools when the collection shape is unknown. YunCMS RBAC applies to every tool call.',
    },
  );
  registerMcpTools(server, req, mcpConfig);
  return server;
}

export function createMcpAccessGuard(mcpConfig = {}) {
  const allowedOrigins = new Set((mcpConfig.allowedOrigins ?? []).map((value) => String(value).toLowerCase()));
  const allowedHosts = new Set((mcpConfig.allowedHosts ?? []).map((value) => String(value).toLowerCase()));
  return (req, res, next) => {
    const host = String(req.get?.('host') ?? '').trim().toLowerCase();
    if (allowedHosts.size > 0 && (!host || !allowedHosts.has(host))) {
      return res.status(403).json({
        errors: [{ code: 'MCP_HOST_FORBIDDEN', message: 'MCP request host is not allowed', request_id: req.id ?? null }],
      });
    }
    const origin = req.get?.('origin') ?? null;
    if (origin && !allowedOrigins.has(String(origin).toLowerCase())) {
      return res.status(403).json({
        errors: [{ code: 'MCP_ORIGIN_FORBIDDEN', message: 'MCP request origin is not allowed', request_id: req.id ?? null }],
      });
    }
    if (mcpConfig.requireAuthentication !== false && req.authMethod === 'public') {
      return res.status(401).json({
        errors: [{ code: 'UNAUTHORIZED', message: 'MCP requires authenticated YunCMS access', request_id: req.id ?? null }],
      });
    }
    return next();
  };
}

export function createMcpRouter({ config, logger = console } = {}) {
  if (!config?.mcp?.enabled) return null;
  const router = express.Router();
  router.use(createMcpAccessGuard(config.mcp));
  router.all('/', (req, res, next) => {
    if (req.method === 'POST') return next();
    res.set('allow', 'POST');
    return res.status(405).json({
      errors: [{ code: 'METHOD_NOT_ALLOWED', message: 'MCP accepts POST requests only', request_id: req.id ?? null }],
    });
  });
  router.post('/', async (req, res, next) => {
    const server = createRequestMcpServer(req, config.mcp);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    let connected = false;
    try {
      await server.connect(transport);
      connected = true;
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) return next(error);
      logger.error?.('YunCMS MCP request failed after response started', {
        requestId: req.id ?? null,
        code: error?.code ?? null,
      });
    } finally {
      if (connected) await server.close().catch(() => {});
    }
    return undefined;
  });
  return router;
}

export { READ_TOOL_NAMES, WRITE_TOOL_NAMES };
