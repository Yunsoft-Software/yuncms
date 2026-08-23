import express from 'express';

function authError() {
  const error = new Error('Yapay Zeka requires an authenticated YunCMS account');
  error.code = 'UNAUTHORIZED';
  return error;
}

function requireAuthenticated(req) {
  if (req?.authMethod === 'public' || !req?.accountability?.user) throw authError();
}

export function createAiRouter({ assistant } = {}) {
  if (!assistant) throw new Error('AI assistant service is required');
  const router = express.Router();

  router.get('/status', (req, res, next) => {
    try {
      requireAuthenticated(req);
      return res.json({ data: assistant.status(), request_id: req.id });
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

export { requireAuthenticated };
