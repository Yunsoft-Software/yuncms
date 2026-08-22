function probeHost(host) {
  const value = String(host ?? '').trim();
  if (!value || value === '0.0.0.0' || value === '::' || value === '::0' || value === '[::]') {
    return '127.0.0.1';
  }
  if (value.includes(':') && !value.startsWith('[')) return `[${value}]`;
  return value;
}

export function localYunCmsHealthUrl({ host, port } = {}) {
  return `http://${probeHost(host)}:${port}/health`;
}

export async function isLocalYunCmsReachable({
  host = '127.0.0.1',
  port,
  fetchFn = globalThis.fetch,
  timeoutMs = 1200,
} = {}) {
  if (typeof fetchFn !== 'function') return false;
  try {
    const response = await fetchFn(localYunCmsHealthUrl({ host, port }), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.status >= 100 && response.status < 600;
  } catch {
    return false;
  }
}

export async function assertYunCmsStopped(options = {}) {
  const running = await isLocalYunCmsReachable(options);
  if (!running) return true;
  const error = new Error('YunCMS is currently reachable; stop the service supervisor before backup, restore or update');
  error.code = 'UPDATE_APPLICATION_RUNNING';
  throw error;
}
