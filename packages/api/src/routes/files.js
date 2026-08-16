import express from 'express';

import { serviceOptionsFromRequest } from '../service-options.js';

function filesService(req) {
  const Service = req.context.services.FilesService;
  return new Service(serviceOptionsFromRequest(req));
}

function notFound(id) {
  const error = new Error(`File not found: ${id}`);
  error.code = 'FILE_NOT_FOUND';
  return error;
}

function decodeFilenameHeader(value) {
  if (!value) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    const error = new Error('Encoded upload filename is invalid');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
}

function attachmentHeader(filename) {
  const safe = String(filename || 'download')
    .replace(/[\r\n]/g, '')
    .replace(/["\\]/g, '_');
  return `attachment; filename="${safe.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export function createFilesRouter({ maxUploadBytes = 25 * 1024 * 1024 } = {}) {
  const router = express.Router();
  const rawUpload = express.raw({ type: 'application/octet-stream', limit: maxUploadBytes });

  router.get('/', async (req, res) => {
    res.json({ data: await filesService(req).readMany() });
  });

  router.post('/', rawUpload, async (req, res) => {
    const filenameDownload = decodeFilenameHeader(req.get('x-filename'));
    const title = req.get('x-title') || null;
    const mimetype = req.get('x-mimetype') || 'application/octet-stream';
    const storage = req.query.storage || 'local';
    const data = await filesService(req).createOne({
      contents: req.body,
      filenameDownload,
      title,
      mimetype,
      storage,
    });
    res.status(201).json({ data });
  });

  router.get('/:id', async (req, res) => {
    const data = await filesService(req).readOne(req.params.id);
    if (!data) throw notFound(req.params.id);
    res.json({ data });
  });

  router.get('/:id/content', async (req, res) => {
    const result = await filesService(req).readContent(req.params.id);
    res.set('content-type', result.file.mimetype || 'application/octet-stream');
    res.set('content-length', String(result.contents.byteLength));
    res.set('content-disposition', attachmentHeader(result.file.filename_download));
    res.send(result.contents);
  });

  router.patch('/:id', async (req, res) => {
    const data = await filesService(req).updateOne(req.params.id, req.body ?? {});
    res.json({ data });
  });

  router.delete('/:id', async (req, res) => {
    await filesService(req).deleteOne(req.params.id);
    res.status(204).end();
  });

  return router;
}

export { attachmentHeader, decodeFilenameHeader };
