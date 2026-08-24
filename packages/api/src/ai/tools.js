import {
  readManyWithRelations,
  readOneWithRelations,
} from '@yunsoft/yuncms-core';
import * as z from 'zod/v4';

import {
  describeReadableCollection,
  listReadableCollections,
} from '../mcp.js';
import { serviceOptionsFromRequest } from '../service-options.js';

const SAFE_TOOL_ERROR_CODES = new Set([
  'FORBIDDEN',
  'FORBIDDEN_FIELD',
  'COLLECTION_NOT_FOUND',
  'INVALID_QUERY',
  'QUERY_COST_LIMIT',
  'QUERY_RELATION_DEPTH_LIMIT',
  'QUERY_RELATION_ROW_LIMIT',
  'INVALID_PAYLOAD',
  'REQUIRED_FIELD_MISSING',
  'FIELD_READ_ONLY',
  'FILTER_REQUIRED',
  'VALIDATION_FAILED',
  'VALIDATION_BULK_LIMIT',
  'FOREIGN_KEY_MISSING',
  'FOREIGN_KEY_RESTRICTED',
  'DUPLICATE_KEY',
]);

const collectionSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const idSchema = z.union([z.string().min(1).max(191), z.number().finite()]);
const delimitedSchema = z.union([
  z.string().min(1).max(2_000),
  z.array(z.string().min(1).max(191)).max(100),
]);
const filterSchema = z.record(z.string(), z.unknown());
const aggregateSchema = z.record(
  z.string(),
  z.union([z.string().min(1), z.array(z.string().min(1)).max(20)]),
);

function toolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArguments(schema, args) {
  const result = schema.safeParse(args ?? {});
  if (result.success) return result.data;
  throw toolError('AI_TOOL_ARGUMENTS_INVALID', 'The assistant generated invalid tool arguments');
}

function itemService(req, collection) {
  const Service = req.context.services.ItemsService;
  return new Service(collection, serviceOptionsFromRequest(req));
}

function readManySchema(maxItems) {
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
  }).strict();
}

const describeSchema = z.object({ collection: collectionSchema }).strict();
const readOneSchema = z.object({
  collection: collectionSchema,
  id: idSchema,
  fields: delimitedSchema.optional(),
  expand: delimitedSchema.optional(),
}).strict();
const createSchema = z.object({
  collection: collectionSchema,
  data: z.record(z.string(), z.unknown()),
}).strict();
const updateSchema = z.object({
  collection: collectionSchema,
  id: idSchema,
  data: z.record(z.string(), z.unknown()),
}).strict();
const deleteSchema = z.object({
  collection: collectionSchema,
  id: idSchema,
}).strict();

function toolDefinition(name, description, parameters) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        additionalProperties: false,
        ...parameters,
      },
    },
  };
}

function readToolDefinitions(maxItems) {
  return [
    toolDefinition(
      'schema_list_collections',
      'List project collections the current YunCMS user is allowed to read. Use this before guessing collection names.',
      { type: 'object', properties: {}, required: [] },
    ),
    toolDefinition(
      'schema_describe_collection',
      'Describe readable fields, direct relations and CRUD capabilities for one collection using the current user permissions.',
      {
        type: 'object',
        properties: { collection: { type: 'string' } },
        required: ['collection'],
      },
    ),
    toolDefinition(
      'items_read_many',
      'Read collection rows with YunCMS filtering, search, sorting, aggregates and relation-aware fields. Normal RBAC and query limits always apply.',
      {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          fields: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, maxItems: 100 }] },
          expand: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, maxItems: 100 }] },
          filter: { type: 'object' },
          search: { type: 'string', maxLength: 200 },
          sort: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, maxItems: 100 }] },
          aggregate: { type: 'object' },
          groupBy: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, maxItems: 100 }] },
          limit: { type: 'integer', minimum: 1, maximum: maxItems },
          offset: { type: 'integer', minimum: 0, maximum: 1_000_000 },
        },
        required: ['collection'],
      },
    ),
    toolDefinition(
      'items_read_one',
      'Read one item by id with optional field and relation selection. Normal YunCMS read permissions apply.',
      {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          id: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          fields: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, maxItems: 100 }] },
          expand: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, maxItems: 100 }] },
        },
        required: ['collection', 'id'],
      },
    ),
  ];
}

function writeToolDefinitions({ deletesEnabled = false } = {}) {
  const tools = [
    toolDefinition(
      'items_create',
      'Create one YunCMS item. Use only when the user clearly asks to create data. Field permissions, validation, hooks and auditing apply.',
      {
        type: 'object',
        properties: { collection: { type: 'string' }, data: { type: 'object' } },
        required: ['collection', 'data'],
      },
    ),
    toolDefinition(
      'items_update',
      'Update one YunCMS item by id. Use only when the user clearly asks to change data. Normal permissions and validation apply.',
      {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          id: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          data: { type: 'object' },
        },
        required: ['collection', 'id', 'data'],
      },
    ),
  ];
  if (deletesEnabled) tools.push(toolDefinition(
      'items_delete',
      'Delete one YunCMS item by id. Use only when the user explicitly asks to delete that item. Normal delete permissions and hooks apply.',
      {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          id: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        },
        required: ['collection', 'id'],
      },
    ));
  return tools;
}

export function aiToolDefinitions({
  writesEnabled = false,
  deletesEnabled = false,
  maxItems = 100,
} = {}) {
  return writesEnabled
    ? [...readToolDefinitions(maxItems), ...writeToolDefinitions({ deletesEnabled })]
    : readToolDefinitions(maxItems);
}

export async function executeAiTool(req, name, args, {
  writesEnabled = false,
  deletesEnabled = false,
  maxItems = 100,
} = {}) {
  if (name === 'schema_list_collections') {
    parseArguments(z.object({}).strict(), args);
    return { collections: await listReadableCollections(req, { maxItems }) };
  }
  if (name === 'schema_describe_collection') {
    const input = parseArguments(describeSchema, args);
    return describeReadableCollection(req, input.collection);
  }
  if (name === 'items_read_many') {
    const { collection, ...query } = parseArguments(readManySchema(maxItems), args);
    return readManyWithRelations({
      collection,
      query: { ...query, limit: query.limit ?? Math.min(100, maxItems) },
      options: serviceOptionsFromRequest(req),
      ItemsServiceClass: req.context.services.ItemsService,
    });
  }
  if (name === 'items_read_one') {
    const input = parseArguments(readOneSchema, args);
    return readOneWithRelations({
      collection: input.collection,
      id: input.id,
      query: {
        ...(input.fields ? { fields: input.fields } : {}),
        ...(input.expand ? { expand: input.expand } : {}),
      },
      options: serviceOptionsFromRequest(req),
      ItemsServiceClass: req.context.services.ItemsService,
    });
  }

  if (!writesEnabled) throw toolError('AI_TOOL_FORBIDDEN', 'Data-changing assistant tools are disabled');

  if (name === 'items_create') {
    const input = parseArguments(createSchema, args);
    return itemService(req, input.collection).createOne(input.data);
  }
  if (name === 'items_update') {
    const input = parseArguments(updateSchema, args);
    return itemService(req, input.collection).updateOne(input.id, input.data);
  }
  if (name === 'items_delete') {
    if (!deletesEnabled) throw toolError('AI_TOOL_FORBIDDEN', 'Assistant delete tools are disabled');
    const input = parseArguments(deleteSchema, args);
    return { deleted: await itemService(req, input.collection).deleteOne(input.id) };
  }

  throw toolError('AI_TOOL_UNKNOWN', 'The assistant requested an unknown tool');
}

export function safeAiToolError(error) {
  const code = SAFE_TOOL_ERROR_CODES.has(error?.code)
    || ['AI_TOOL_ARGUMENTS_INVALID', 'AI_TOOL_FORBIDDEN', 'AI_TOOL_UNKNOWN'].includes(error?.code)
    ? error.code
    : 'INTERNAL_ERROR';
  return {
    error: {
      code,
      message: code === 'INTERNAL_ERROR'
        ? 'Tool execution failed'
        : String(error?.message ?? 'Tool execution failed'),
    },
  };
}

export function serializeAiToolResult(value, maxBytes = 250_000) {
  const text = JSON.stringify({ data: value });
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  return JSON.stringify({
    error: {
      code: 'AI_TOOL_RESULT_TOO_LARGE',
      message: `Tool result exceeds the configured ${maxBytes} byte limit. Narrow the query and try again.`,
    },
  });
}

export function operationSummary(name, args = {}, success = true) {
  return {
    operation: name,
    collection: typeof args.collection === 'string' ? args.collection : null,
    success,
  };
}
