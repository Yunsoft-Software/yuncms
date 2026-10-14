import { AsyncLocalStorage } from 'node:async_hooks';
export const flowExecutionStorage = new AsyncLocalStorage();
export function withFlowEvents(enabled, operation) {
  return flowExecutionStorage.run({ ...(flowExecutionStorage.getStore() ?? {}), suppressFlowEvents: !enabled }, operation);
}
