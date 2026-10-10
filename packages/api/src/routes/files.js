import { pipeline } from 'node:stream/promises';
import express from 'express';

import { evaluateRangeRequest } from '../byte-range.js';
import { serviceOptionsFromRequest } from '../service-options.js';

function filesService(req) {
  const Service = req.context.services.FilesService;
  return new Service(serviceOptionsFromRequest(req));
}

function reconciliationService(req) {
  const Service = req.context.services.FileReconciliationService;
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

async function pipeStreamToResponse(stream, res) {
  let upstreamDestroyed = false;
  const destroyUpstream = () => {
    if (upstreamDestroyed) return;
    upstreamDestroyed = true;
    if (stream && typeof stream.destroy === 'function' && !stream.destroyed) {
      try {
        stream.destroy();
      } catch {}
    }
  };

  const onClose = () => {
    if (!res.writableEnded) {
      destroyUpstream();
    }
  };

  res.on('close', onClose);

  try {
    await pipeline(stream, res);
  } catch (error) {
    destroyUpstream();
    if (res.headersSent || res.destroyed) {
      return;
    }
    throw error;
  } finally {
    res.off('close', onClose);
    if (!res.writableEnded) {
      destroyUpstream();
    }
  }
}

function clearFileHeaders(res) {
  res.removeHeader('accept-ranges');
  res.removeHeader('content-type');
  res.removeHeader('content-disposition');
  res.removeHeader('content-length');
  res.removeHeader('content-range');
  res.removeHeader('etag');
  res.removeHeader('last-modified');
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

  router.post('/reconcile', async (req, res) => {
    const data = await reconciliationService(req).scan({
      storage: req.body?.storage ?? 'local',
      deleteOrphans: req.body?.deleteOrphans === true,
      minimumAgeMs: req.body?.minimumAgeMs,
    });
    res.json({ data });
  });

  router.get('/:id', async (req, res) => {
    const data = await filesService(req).readOne(req.params.id);
    if (!data) throw notFound(req.params.id);
    res.json({ data });
  });

  router.head('/:id/content', async (req, res) => {
    const info = await filesService(req).readContentInfo(req.params.id);
    res.set('etag', info.etag);
    if (info.modifiedAt) {
      res.set('last-modified', info.modifiedAt.toUTCString());
    }
    res.set('accept-ranges', 'bytes');
    res.set('content-type', info.file.mimetype || 'application/octet-stream');
    res.set('content-disposition', attachmentHeader(info.file.filename_download));
    if (req.fresh) {
      return res.status(304).end();
    }
    res.set('content-length', String(info.size));
    res.status(200).end();
  });

  router.get('/:id/content', async (req, res) => {
    const service = filesService(req);
    const info = await service.readContentInfo(req.params.id);

    res.set('etag', info.etag);
    if (info.modifiedAt) {
      res.set('last-modified', info.modifiedAt.toUTCString());
    }

    if (req.fresh) {
      res.set('accept-ranges', 'bytes');
      res.set('content-type', info.file.mimetype || 'application/octet-stream');
      res.set('content-disposition', attachmentHeader(info.file.filename_download));
      return res.status(304).end();
    }

    if (req.method === 'HEAD') {
      res.set('accept-ranges', 'bytes');
      res.set('content-type', info.file.mimetype || 'application/octet-stream');
      res.set('content-disposition', attachmentHeader(info.file.filename_download));
      res.set('content-length', String(info.size));
      return res.status(200).end();
    }

    const evaluation = evaluateRangeRequest({
      rangeHeader: req.get('range'),
      ifRangeHeader: req.get('if-range'),
      size: info.size,
      etag: info.etag,
      modifiedAt: info.modifiedAt,
    });

    if (evaluation.status === 416) {
      res.set('accept-ranges', 'bytes');
      res.set('content-type', info.file.mimetype || 'application/octet-stream');
      res.set('content-disposition', attachmentHeader(info.file.filename_download));
      res.set('content-range', evaluation.contentRange);
      res.set('content-length', '0');
      return res.status(416).end();
    }

    let streamResult;
    try {
      if (evaluation.status === 206) {
        streamResult = await service.readContentStream(req.params.id, {
          start: evaluation.start,
          end: evaluation.end,
        });
      } else {
        streamResult = await service.readContentStream(req.params.id);
      }
    } catch (streamError) {
      clearFileHeaders(res);
      throw streamError;
    }

    res.set('accept-ranges', 'bytes');
    res.set('content-type', info.file.mimetype || 'application/octet-stream');
    res.set('content-disposition', attachmentHeader(info.file.filename_download));

    if (evaluation.status === 206) {
      res.status(206);
      res.set('content-range', evaluation.contentRange);
      res.set('content-length', String(evaluation.contentLength));
      return pipeStreamToResponse(streamResult.stream, res);
    }

    res.status(200);
    res.set('content-length', String(info.size));
    return pipeStreamToResponse(streamResult.stream, res);
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
