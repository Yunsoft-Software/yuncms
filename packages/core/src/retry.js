import { isRetryableDatabaseError } from './errors.js';

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDatabaseRetry(operation, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 25;
  const sleep = options.sleep ?? defaultSleep;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error('maxAttempts must be an integer between 1 and 10');
  }

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      return await operation({ attempt, maxAttempts });
    } catch (error) {
      if (!isRetryableDatabaseError(error) || attempt >= maxAttempts) throw error;
      await sleep(baseDelayMs * attempt);
    }
  }

  throw new Error('Database retry loop exited unexpectedly');
}
