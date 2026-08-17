import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_STUDIO_ROOT = fileURLToPath(new URL('../studio-dist/', import.meta.url));

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

export function resolveStudioFile(root, requestPath) {
  if (requestPath === '/') return resolve(root, 'index.html');
  if (!requestPath.startsWith('/assets/')) return null;

  let relativePath;
  try {
    relativePath = decodeURIComponent(requestPath.slice(1));
  } catch {
    return null;
  }

  const assetsRoot = resolve(root, 'assets');
  const candidate = resolve(root, relativePath);
  if (candidate !== assetsRoot && !candidate.startsWith(`${assetsRoot}${sep}`)) return null;
  return candidate;
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream';
}

export function createStudioMiddleware({ root = DEFAULT_STUDIO_ROOT } = {}) {
  return async function serveStudio(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const filePath = resolveStudioFile(root, req.path);
    if (!filePath) return next();

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') return next(error);
      if (req.path === '/') {
        return res.status(503).type('text/plain').send(
          'YunCMS Studio build is missing. Build @yunsoft/yuncms-studio before starting the API.',
        );
      }
      return res.status(404).end();
    }

    if (!fileStat.isFile()) return res.status(404).end();

    res.set('content-type', contentTypeFor(filePath));
    res.set('content-length', String(fileStat.size));
    res.set('cache-control', req.path === '/'
      ? 'no-cache'
      : 'public, max-age=31536000, immutable');

    if (req.method === 'HEAD') return res.status(200).end();

    const stream = createReadStream(filePath);
    stream.on('error', next);
    return stream.pipe(res);
  };
}
