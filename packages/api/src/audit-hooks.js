import { createSystemAccountability } from '@yunsoft/yuncms-core';
import { INTERNAL_AUDIT_EVENTS } from './audit-events.js';

export function registerInternalAudit({ emitter, services, database, logger }) {
  const AuditService = services.AuditService;
  const systemAccountability = createSystemAccountability();
  for (const event of INTERNAL_AUDIT_EVENTS) {
    emitter.registerAction(event, async (payload, context) => {
      try {
        const audit = new AuditService({ accountability: systemAccountability,
          database: context.database ?? database, logger, requestId: context.requestId ?? null });
        await audit.record({
          user: context.accountability?.user ?? null,
          action: event,
          collection: context.collection ?? null,
          itemKey: payload?.key ?? null,
          requestId: context.requestId ?? null,
          payload,
        });
      } catch (error) {
        logger.error('YunCMS audit write failed after committed mutation', {
          event, requestId: context.requestId ?? null, code: error?.code, error,
        });
      }
    }, { extensionId: 'core.audit', priority: 1000 });
  }
}
