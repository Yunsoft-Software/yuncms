import express from 'express';
import { readManyWithRelations, readOneWithRelations, withTransaction } from '@yunsoft/yuncms-core';

import { serviceOptionsFromRequest } from '../service-options.js';

export function createItemsRouter() {
  const router = express.Router();
  const wantsState = req => req.get('prefer')?.split(',').map(value => value.trim()).includes('yuncms-edit-state');
  async function readableState(service, id) {
    try { return await service.readEditState(id); }
    catch (error) {
      // A successful create/update must not acquire a new read-permission
      // requirement merely because the client requested optional metadata.
      if (['FORBIDDEN', 'FORBIDDEN_FIELD'].includes(error.code)) return null;
      throw error;
    }
  }

  router.get('/:collection', async (req, res) => {
    const Service = req.context.services.ItemsService;
    if (wantsState(req)) {
      const result = await withTransaction(req.context.database, async database => {
        const options = serviceOptionsFromRequest(req, { database });
        const result = await readManyWithRelations({ collection: req.params.collection, query: req.query, options, ItemsServiceClass: Service });
        const service = new Service(req.params.collection, options);
        const schema = await service.getCollectionSchema();
        const revisions = await service.readEditStates(result.data.map(row => row[schema.primary_key]).filter(key => key != null));
        return { ...result, meta: { ...result.meta, revisions, primaryKey: schema.primary_key } };
      }, { isolationLevel: 'REPEATABLE READ' });
      res.set('preference-applied', 'yuncms-edit-state');
      return res.json(result);
    }
    const result = await readManyWithRelations({
      collection: req.params.collection,
      query: req.query,
      options: serviceOptionsFromRequest(req),
      ItemsServiceClass: Service,
    });
    res.json(result);
  });

  router.get('/:collection/:id', async (req, res) => {
    const Service = req.context.services.ItemsService;
    if (wantsState(req)) {
      const result = await withTransaction(req.context.database, async database => {
        const options = serviceOptionsFromRequest(req, { database });
        const service = new Service(req.params.collection, options);
        const state = await service.readEditState(req.params.id);
        if (!state) return null;
        const data = await readOneWithRelations({ collection: req.params.collection, id: req.params.id,
          query: req.query, options, ItemsServiceClass: Service });
        return { data, meta: state };
      }, { isolationLevel: 'REPEATABLE READ' });
      if (!result?.data) {
        const error = new Error('Item not found'); error.code = 'NOT_FOUND'; throw error;
      }
      res.set('preference-applied', 'yuncms-edit-state');
      return res.json(result);
    }
    const data = await readOneWithRelations({
      collection: req.params.collection,
      id: req.params.id,
      query: req.query,
      options: serviceOptionsFromRequest(req),
      ItemsServiceClass: Service,
    });

    if (!data) {
      const error = new Error('Item not found');
      error.code = 'NOT_FOUND';
      throw error;
    }

    res.json({ data });
  });

  function history(req) {
    const Service = req.context.services.ContentRevisionsService;
    return new Service(req.params.collection, serviceOptionsFromRequest(req));
  }
  router.get('/:collection/:id/revisions', async (req, res) => {
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (Object.keys(req.query).some(key => !['limit', 'offset'].includes(key))) {
      const error = new Error('Unsupported revision query'); error.code = 'INVALID_QUERY'; throw error;
    }
    res.json({ data: await history(req).readRevisions(req.params.id, { limit, offset }) });
  });
  router.get('/:collection/:id/revisions/:revision', async (req, res) => {
    res.json({ data: await history(req).readRevision(req.params.id, req.params.revision) });
  });
  router.post('/:collection/:id/revisions/:revision/restore', async (req, res) => {
    res.json({ data: await history(req).restoreRevision(req.params.id, req.params.revision,
      { expectedRevision: req.get('x-yuncms-item-revision') }) });
  });

  router.post('/:collection', async (req, res) => {
    const Service = req.context.services.ItemsService;
    const service = new Service(req.params.collection, serviceOptionsFromRequest(req));
    if (!wantsState(req)) return res.status(201).json({ data: await service.createOne(req.body) });
    const result = await withTransaction(req.context.database, async database => {
      const writer = new Service(req.params.collection, serviceOptionsFromRequest(req, { database }));
      const data = await writer.createOne(req.body);
      const schema = await writer.getCollectionSchema();
      return { data, meta: await readableState(writer, data[schema.primary_key]) };
    });
    res.status(201).json(result);
  });

  router.patch('/:collection/:id', async (req, res) => {
    const Service = req.context.services.ItemsService;
    const result = await withTransaction(req.context.database, async database => {
      const service = new Service(req.params.collection, serviceOptionsFromRequest(req, { database }));
      const data = await service.updateOne(req.params.id, req.body, { expectedRevision: req.get('x-yuncms-item-revision') ?? null });
      return { data, ...(data && wantsState(req) ? { meta: await readableState(service, req.params.id) } : {}) };
    });
    const { data } = result;

    if (!data) {
      const error = new Error('Item not found or not accessible');
      error.code = 'NOT_FOUND';
      throw error;
    }

    res.json(result);
  });

  router.delete('/:collection/:id', async (req, res) => {
    const Service = req.context.services.ItemsService;
    const service = new Service(req.params.collection, serviceOptionsFromRequest(req));
    const deleted = await service.deleteOne(req.params.id, { expectedRevision: req.get('x-yuncms-item-revision') ?? null });

    if (!deleted) {
      const error = new Error('Item not found or not accessible');
      error.code = 'NOT_FOUND';
      throw error;
    }

    res.status(204).end();
  });

  return router;
}
