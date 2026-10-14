import { createSystemAccountability, FlowsService, FLOW_FILTER_EVENTS, FLOW_ACTION_EVENTS, flowExecutionStorage, parseFlowCronExpression, flowCronMatchesUtc } from '@yunsoft/yuncms-core';

export class FlowRuntime {
  constructor(options) {
    this.options = options;
    this.timer = null; this.running = null; this.scheduleRunning = null; this.stopping = false; this.unsubscribers = [];
    this.lastScheduleSecond = null;
  }
  service(extra = {}) { return new FlowsService({ ...this.options, accountability: createSystemAccountability(), ...extra }); }
  registerHooks() {
    const emitter = this.options.emitter;
    for (const event of FLOW_FILTER_EVENTS) this.unsubscribers.push(emitter.registerFilter(event, async (payload, context) => {
      const execution = flowExecutionStorage.getStore();
      if (execution?.suppressFlowEvents) return payload;
      const service = this.service({ database: context.database ?? this.options.database, requestId: context.requestId });
      const flows = await service.dispatchable('event');
      let result = payload;
      for (const flow of flows) {
        if (flow.options.mode !== 'filter' || !this.matches(flow, event, context) || execution?.stack?.includes(flow.id)) continue;
        if (!context.accountability || context.transaction?.state !== 'active') throw Object.assign(new Error('Blocking flows require verified accountability and an active native transaction'), { code: 'FLOW_TRANSACTION_REQUIRED' });
        const run = await service.runTriggered(flow.id, { event, collection: context.collection, key: context.key ?? payload.key ?? null, payload: result }, context.accountability, { revision: flow.revision });
        if (flow.options.response) result = run.output;
      }
      return result;
    }, { extensionId: 'core.flows', priority: -100 }));
    for (const event of FLOW_ACTION_EVENTS) this.unsubscribers.push(emitter.registerAction(event, async (payload, context) => {
      const execution = flowExecutionStorage.getStore();
      if (execution?.suppressFlowEvents || !context.accountability) return;
      const service = this.service({ database: context.database ?? this.options.database, requestId: context.requestId });
      for (const flow of await service.dispatchable('event')) {
        if (flow.options.mode !== 'action' || !this.matches(flow, event, context) || execution?.stack?.includes(flow.id)) continue;
        await service.enqueue(flow, { event, collection: context.collection, payload }, context.accountability);
      }
    }, { extensionId: 'core.flows', priority: -100 }));
    return this;
  }
  matches(flow, event, context) {
    return flow.options.events.includes(event) && flow.options.collections.includes(context.collection);
  }
  async scheduleTick(date = new Date()) {
    const service = this.service();
    const second = date.toISOString().slice(0, 19);
    if (this.lastScheduleSecond !== second) {
      this.lastScheduleSecond = second;
      for (const flow of await service.dispatchable('schedule')) {
        const parsed = parseFlowCronExpression(flow.options.cron);
        if (flowCronMatchesUtc(parsed, date)) await service.enqueue(flow, { scheduled_at: date.toISOString() }, createSystemAccountability(), { scheduleKey: second });
      }
    }
  }
  async tick(date = new Date()) {
    await this.scheduleTick(date);
    await this.service().runNext();
  }
  pump(date = new Date()) {
    if (this.stopping) return;
    const failed = error => this.options.logger?.error?.('YunCMS flow worker failed', { code: error.code ?? 'FLOW_WORKER_FAILED' });
    if (!this.scheduleRunning) this.scheduleRunning = this.scheduleTick(date).catch(failed).finally(() => { this.scheduleRunning = null; });
    if (!this.running) this.running = this.service().runNext().catch(failed).finally(() => { this.running = null; });
  }
  start() {
    if (this.timer) return;
    this.stopping = false;
    const tick = () => this.pump();
    this.timer = setInterval(tick, 1000); this.timer.unref?.(); tick();
  }
  async stop() {
    this.stopping = true; clearInterval(this.timer); this.timer = null;
    await Promise.all([this.running, this.scheduleRunning]);
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
  }
}
