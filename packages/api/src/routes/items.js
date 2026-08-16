import express from 'express';
import { readManyWithRelations, readOneWithRelations } from '@yuncms/core';

import { serviceOptionsFromRequest } from '../service-options.js';

export function createItemsRouter() {
  const router = express.Router();

  router.get('/:collection', async (req, res) => {
    const Service = req.context.services.ItemsService;
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

  router.post('/:collection', async (req, res) => {
    const Service = req.context.services.ItemsService;
    const service = new Service(req.params.collection, serviceOptionsFromRequest(req));
    const data = await service.createOne(req.body);
    res.status(201).json({ data });
  });

  router.patch('/:collection/:id', async (req, res) => {
    const Service = req.context.services.ItemsService;
    const service = new Service(req.params.collection, serviceOptionsFromRequest(req));
    const data = await service.updateOne(req.params.id, req.body);

    if (!data) {
      const error = new Error('Item not found or not accessible');
      error.code = 'NOT_FOUND';
      throw error;
    }

    res.json({ data });
  });

  router.delete('/:collection/:id', async (req, res) => {
    const Service = req.context.services.ItemsService;
    const service = new Service(req.params.collection, serviceOptionsFromRequest(req));
    const deleted = await service.deleteOne(req.params.id);

    if (!deleted) {
      const error = new Error('Item not found or not accessible');
      error.code = 'NOT_FOUND';
      throw error;
    }

    res.status(204).end();
  });

  return router;
}
