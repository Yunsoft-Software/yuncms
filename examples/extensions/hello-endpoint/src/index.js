import { defineEndpoint } from '@yuncms/extensions-sdk';

export default defineEndpoint((router, context) => {
  router.get('/', async (req, res) => {
    const schema = await context.getSchema();

    res.json({
      data: {
        message: 'Hello from a YunCMS endpoint extension',
        user: req.accountability?.user ?? null,
        role: req.accountability?.role ?? null,
        schema_version: schema.version,
      },
    });
  });
});
