import express from 'express';
import { deleteM2MJunction } from '@yuncms/core';

import { serviceOptionsFromRequest } from '../service-options.js';

function service(req, name) {
  const Service = req.context.services[name];
  if (!Service) throw new Error(`Service is not registered: ${name}`);
  return new Service(serviceOptionsFromRequest(req));
}

function destructiveRequested(req) {
  return String(req.query?.destructive ?? '').toLowerCase() === 'true';
}

async function auditSchema(req, { action, collection = null, itemKey = null, payload = null }) {
  try {
    await service(req, 'AuditService').record({
      action,
      collection,
      itemKey,
      requestId: req.id,
      payload,
    });
  } catch (error) {
    req.context.logger?.error?.('YunCMS schema audit write failed after committed mutation', {
      requestId: req.id,
      action,
      collection,
      itemKey,
      code: error?.code,
      message: error?.message,
    });
  }
}

export function createSchemaRouter() {
  const router = express.Router();

  router.get('/collections', async (req, res) => {
    res.json({ data: await service(req, 'CollectionsService').readMany() });
  });

  router.post('/collections', async (req, res) => {
    const data = await service(req, 'CollectionsService').createOne(req.body ?? {});
    await auditSchema(req, {
      action: 'schema.collection.create',
      collection: data.collection,
      itemKey: data.collection,
      payload: { after: data },
    });
    res.status(201).json({ data });
  });

  router.get('/collections/:collection', async (req, res) => {
    const data = await service(req, 'CollectionsService').readOne(req.params.collection);
    if (!data) {
      const error = new Error(`Collection not found: ${req.params.collection}`);
      error.code = 'COLLECTION_NOT_FOUND';
      throw error;
    }
    res.json({ data });
  });

  router.patch('/collections/:collection', async (req, res) => {
    const collections = service(req, 'CollectionsService');
    const before = await collections.readOne(req.params.collection);
    const data = await collections.updateOne(req.params.collection, req.body ?? {});
    await auditSchema(req, {
      action: 'schema.collection.update',
      collection: req.params.collection,
      itemKey: req.params.collection,
      payload: { before, after: data, changes: req.body ?? {} },
    });
    res.json({ data });
  });

  router.delete('/collections/:collection', async (req, res) => {
    const collections = service(req, 'CollectionsService');
    const before = await collections.readOne(req.params.collection);
    await collections.deleteOne(req.params.collection, {
      destructive: destructiveRequested(req),
    });
    await auditSchema(req, {
      action: 'schema.collection.delete',
      collection: req.params.collection,
      itemKey: req.params.collection,
      payload: { before },
    });
    res.status(204).end();
  });

  router.get('/collections/:collection/fields', async (req, res) => {
    res.json({ data: await service(req, 'FieldsService').readMany(req.params.collection) });
  });

  router.post('/collections/:collection/fields', async (req, res) => {
    const data = await service(req, 'FieldsService').createOne(
      req.params.collection,
      req.body ?? {},
    );
    await auditSchema(req, {
      action: 'schema.field.create',
      collection: req.params.collection,
      itemKey: data.field,
      payload: { after: data },
    });
    res.status(201).json({ data });
  });

  router.get('/collections/:collection/fields/:field', async (req, res) => {
    const data = await service(req, 'FieldsService').readOne(
      req.params.collection,
      req.params.field,
    );
    if (!data) {
      const error = new Error(`Field not found: ${req.params.collection}.${req.params.field}`);
      error.code = 'FIELD_NOT_FOUND';
      throw error;
    }
    res.json({ data });
  });

  router.patch('/collections/:collection/fields/:field', async (req, res) => {
    const fields = service(req, 'FieldsService');
    const before = await fields.readOne(req.params.collection, req.params.field);
    const data = await fields.updateOne(
      req.params.collection,
      req.params.field,
      req.body ?? {},
    );
    await auditSchema(req, {
      action: 'schema.field.update',
      collection: req.params.collection,
      itemKey: req.params.field,
      payload: { before, after: data, changes: req.body ?? {} },
    });
    res.json({ data });
  });

  router.patch('/collections/:collection/fields/:field/schema', async (req, res) => {
    const fields = service(req, 'FieldsService');
    const before = await fields.readOne(req.params.collection, req.params.field);
    const data = await fields.updateSchema(
      req.params.collection,
      req.params.field,
      req.body ?? {},
    );
    await auditSchema(req, {
      action: 'schema.field.alter',
      collection: req.params.collection,
      itemKey: req.params.field,
      payload: { before, after: data, changes: req.body ?? {} },
    });
    res.json({ data });
  });

  router.delete('/collections/:collection/fields/:field', async (req, res) => {
    const fields = service(req, 'FieldsService');
    const before = await fields.readOne(req.params.collection, req.params.field);
    await fields.deleteOne(
      req.params.collection,
      req.params.field,
      { destructive: destructiveRequested(req) },
    );
    await auditSchema(req, {
      action: 'schema.field.delete',
      collection: req.params.collection,
      itemKey: req.params.field,
      payload: { before },
    });
    res.status(204).end();
  });

  router.get('/relations', async (req, res) => {
    res.json({ data: await service(req, 'RelationsService').readMany() });
  });

  router.get('/relations/:manyCollection/:manyField', async (req, res) => {
    const data = await service(req, 'RelationsService').readOne(
      req.params.manyCollection,
      req.params.manyField,
    );
    if (!data) {
      const error = new Error(
        `Relation not found: ${req.params.manyCollection}.${req.params.manyField}`,
      );
      error.code = 'RELATION_NOT_FOUND';
      throw error;
    }
    res.json({ data });
  });

  router.get('/collections/:collection/relations/o2m', async (req, res) => {
    res.json({ data: await service(req, 'RelationsService').readO2M(req.params.collection) });
  });

  router.post('/relations/m2o', async (req, res) => {
    const data = await service(req, 'RelationsService').createM2O(req.body ?? {});
    await auditSchema(req, {
      action: 'schema.relation.create',
      collection: data.many_collection,
      itemKey: data.many_field,
      payload: { after: data },
    });
    res.status(201).json({ data });
  });

  router.delete('/relations/m2o/:manyCollection/:manyField', async (req, res) => {
    const relations = service(req, 'RelationsService');
    const before = await relations.readOne(req.params.manyCollection, req.params.manyField);
    await relations.deleteM2O(
      req.params.manyCollection,
      req.params.manyField,
    );
    await auditSchema(req, {
      action: 'schema.relation.delete',
      collection: req.params.manyCollection,
      itemKey: req.params.manyField,
      payload: { before },
    });
    res.status(204).end();
  });

  router.post('/relations/m2m', async (req, res) => {
    const data = await service(req, 'RelationsService').createM2M(req.body ?? {});
    await auditSchema(req, {
      action: 'schema.relation.m2m.create',
      collection: data.junctionCollection,
      itemKey: data.junctionCollection,
      payload: { after: data },
    });
    res.status(201).json({ data });
  });

  router.delete('/relations/m2m/:junctionCollection', async (req, res) => {
    const relationRows = await service(req, 'RelationsService').readMany();
    const before = relationRows.filter(
      (relation) => relation.junction_collection === req.params.junctionCollection,
    );
    const data = await deleteM2MJunction({
      database: req.context.database,
      accountability: req.accountability,
      junctionCollection: req.params.junctionCollection,
      destructive: destructiveRequested(req),
    });
    await auditSchema(req, {
      action: 'schema.relation.m2m.delete',
      collection: req.params.junctionCollection,
      itemKey: req.params.junctionCollection,
      payload: { before, result: data },
    });
    res.status(204).end();
  });

  return router;
}

export { auditSchema, destructiveRequested };
