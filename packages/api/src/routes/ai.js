import express from 'express';

function authError() {
  const error = new Error('Yapay Zeka requires an authenticated YunCMS account');
  error.code = 'UNAUTHORIZED';
  return error;
}

function requireAuthenticated(req) {
  if (req?.authMethod === 'public' || !req?.accountability?.user) throw authError();
}

function requireAdministrator(req) {
  requireAuthenticated(req);
  if (req.accountability?.admin === true || req.accountability?.system === true) return;
  const error = new Error('Yapay Zeka settings require administrator access');
  error.code = 'FORBIDDEN';
  throw error;
}

export function createAiRouter({ assistant, settingsStore } = {}) {
  if (!assistant) throw new Error('AI assistant service is required');
  if (!settingsStore) throw new Error('AI settings store is required');
  const router = express.Router();

  router.get('/status', async (req, res, next) => {
    try {
      requireAuthenticated(req);
      return res.json({ data: await assistant.status(), request_id: req.id });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/settings', async (req, res, next) => {
    try {
      requireAdministrator(req);
      return res.json({ data: await settingsStore.readAdmin(), request_id: req.id });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/settings', async (req, res, next) => {
    try {
      requireAdministrator(req);
      const data = await settingsStore.update(req.body ?? {});
      return res.json({ data, request_id: req.id });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/chat', async (req, res, next) => {
    try {
      requireAuthenticated(req);
      const result = await assistant.chat(req, {
        messages: req.body?.messages,
        locale: req.body?.locale,
        allowWrites: req.body?.allow_writes === true,
      });
      return res.json({ data: result, request_id: req.id });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export { requireAdministrator, requireAuthenticated };
