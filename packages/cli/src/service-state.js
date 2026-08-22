export async function isLocalYunCmsReachable({
  port,
  fetchFn = globalThis.fetch,
  timeoutMs = 1200,
} = {}) {
  if (typeof fetchFn !== 'function') return false;
  try {
    const response = await fetchFn(`http://127.0.0.1:${port}/health`, {
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
  const error = new Error('YunCMS is currently reachable; stop the service supervisor before backup/update');
  error.code = 'UPDATE_APPLICATION_RUNNING';
  throw error;
}
