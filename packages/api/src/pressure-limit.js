import { getHeapStatistics } from 'node:v8';

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}

export function createPressureLimit({
  enabled = true,
  maxConcurrent = 250,
  maxHeapPercent = 95,
  retryAfterSeconds = 1,
  memoryUsage = () => process.memoryUsage(),
  heapSizeLimit = () => getHeapStatistics().heap_size_limit,
} = {}) {
  if (!enabled) return null;
  assertPositiveInteger(maxConcurrent, 'Pressure maxConcurrent');
  assertPositiveInteger(maxHeapPercent, 'Pressure maxHeapPercent');
  if (maxHeapPercent > 100) throw new Error('Pressure maxHeapPercent cannot exceed 100');
  assertPositiveInteger(retryAfterSeconds, 'Pressure retryAfterSeconds');
  if (typeof memoryUsage !== 'function') throw new Error('Pressure memoryUsage must be a function');
  if (typeof heapSizeLimit !== 'function') throw new Error('Pressure heapSizeLimit must be a function');

  let inFlight = 0;

  return (req, res, next) => {
    const memory = memoryUsage();
    const heapLimit = heapSizeLimit();
    const heapPercent = Number.isFinite(heapLimit) && heapLimit > 0
      ? (memory.heapUsed / heapLimit) * 100
      : 0;
    const overloaded = inFlight >= maxConcurrent || heapPercent >= maxHeapPercent;

    if (overloaded) {
      res.set('retry-after', String(retryAfterSeconds));
      res.status(503).json({
        errors: [{
          code: 'SERVER_PRESSURE',
          message: 'Server is temporarily under pressure',
          request_id: req.id ?? null,
        }],
      });
      return;
    }

    inFlight += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inFlight = Math.max(0, inFlight - 1);
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}
