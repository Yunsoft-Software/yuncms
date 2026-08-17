import { defineHook } from '@yunsoft/yuncms-extensions-sdk';

export default defineHook(({ filter, init }) => {
  init('app.beforeStart', ({ logger }) => {
    logger.info?.('normalize-title hook ready');
  });

  filter('items.create', (payload, context) => {
    if (context.collection !== 'articles') return payload;
    if (typeof payload.title !== 'string') return payload;

    return {
      ...payload,
      title: payload.title.trim(),
    };
  });
});
