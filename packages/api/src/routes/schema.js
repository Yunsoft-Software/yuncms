import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function service(req, name) {
  const Service = req.context.services[name];
  if (!Service) throw new Error(`Service is not registered: ${name}`);
  return new Service(serviceOptionsFromRequest(req));
}

function destructiveRequested(req) {
  return String(req.query?.destructive ?? '').toLowerCase() === 'true';
}

export function createSchemaRouter() {
  const router = express.Router();

  router.get('/collections', async (req, res) => {
    res.json({ data: await service(req, 'CollectionsService').readMany() });
  });

  router.post('/collections', async (req, res) => {
    const data = await service(req, 'CollectionsService').createOne(req.body ?? {});
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
    const data = await service(req, 'CollectionsService').updateOne(
      req.params.collection,
      req.body ?? {},
    );
    res.json({ data });
  });

  router.delete('/collections/:collection', async (req, res) => {
    await service(req, 'CollectionsService').deleteOne(req.params.collection, {
      destructive: destructiveRequested(req),
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
    const data = await service(req, 'FieldsService').updateOne(
      req.params.collection,
      req.params.field,
      req.body ?? {},
    );
    res.json({ data });
  });

  router.patch('/collections/:collection/fields/:field/schema', async (req, res) => {
    const data = await service(req, 'FieldsService').updateSchema(
      req.params.collection,
      req.params.field,
      req.body ?? {},
    );
    res.json({ data });
  });

  router.delete('/collections/:collection/fields/:field', async (req, res) => {
    await service(req, 'FieldsService').deleteOne(
      req.params.collection,
      req.params.field,
      { destructive: destructiveRequested(req) },
    );
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
    res.status(201).json({ data });
  });

  router.delete('/relations/m2o/:manyCollection/:manyField', async (req, res) => {
    await service(req, 'RelationsService').deleteM2O(
      req.params.manyCollection,
      req.params.manyField,
    );
    res.status(204).end();
  });

  router.post('/relations/m2m', async (req, res) => {
    const data = await service(req, 'RelationsService').createM2M(req.body ?? {});
    res.status(201).json({ data });
  });

  return router;
}

export { destructiveRequested };
