import { useEffect, useMemo, useRef, useState } from 'react';

import { aiChat, aiStatus } from '../api.js';
import { trimConversationHistory } from '../ai-history.js';
import { useI18n } from '../i18n.js';

const STARTER_KEYS = Object.freeze([
  'ai.starterCollections',
  'ai.starterStructure',
  'ai.starterOverview',
]);

const OPERATION_KEYS = Object.freeze({
  schema_list_collections: 'ai.operationCollections',
  schema_describe_collection: 'ai.operationSchema',
  items_read_many: 'ai.operationReadMany',
  items_read_one: 'ai.operationReadOne',
  items_create: 'ai.operationCreate',
  items_update: 'ai.operationUpdate',
  items_delete: 'ai.operationDelete',
});

function operationText(operation, t) {
  const key = OPERATION_KEYS[operation?.operation] ?? 'ai.operationGeneric';
  return t(key, { collection: operation?.collection || t('ai.operationData') });
}

export function AiScreen() {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [allowWrites, setAllowWrites] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    aiStatus()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setStatusError('');
      })
      .catch((requestError) => {
        if (cancelled) return;
        setStatus(null);
        setStatusError(requestError.message || t('ai.statusFailed'));
      });
    return () => { cancelled = true; };
  }, [t]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [messages, sending]);

  const ready = Boolean(status?.enabled && status?.configured);
  const history = useMemo(
    () => messages.map((message) => ({ role: message.role, content: message.content })),
    [messages],
  );

  async function sendMessage(value = draft) {
    const content = String(value ?? '').trim();
    if (!content || sending || !ready) return;

    const userMessage = { role: 'user', content };
    const nextMessages = [...messages, userMessage];
    const nextHistory = trimConversationHistory(
      [...history, userMessage],
      Number(status?.max_history) || 20,
    );
    setMessages(nextMessages);
    setDraft('');
    setError('');
    setSending(true);

    try {
      const result = await aiChat(nextHistory, { locale, allowWrites });
      setMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content: result?.message || t('ai.emptyResponse'),
          operations: Array.isArray(result?.operations) ? result.operations : [],
        },
      ]);
    } catch (requestError) {
      setError(requestError.message || t('ai.requestFailed'));
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    sendMessage();
  }

  function clearConversation() {
    if (sending) return;
    setMessages([]);
    setDraft('');
    setError('');
    setAllowWrites(false);
  }

  return (
    <section className="ai-workspace" aria-label={t('ai.title')}>
      <div className="ai-toolbar">
        <div className="ai-status-group">
          <span className={`ai-status-dot ${ready ? 'ready' : 'offline'}`} aria-hidden="true" />
          <div>
            <strong>{ready ? t('ai.ready') : t('ai.notReady')}</strong>
            <small>{ready ? t('ai.readyHint') : t('ai.notReadyHint')}</small>
          </div>
        </div>
        <button
          className="secondary-button ai-new-chat"
          type="button"
          disabled={sending || messages.length === 0}
          onClick={clearConversation}
        >
          {t('ai.newChat')}
        </button>
      </div>

      {statusError && <div className="error-banner ai-banner" role="alert">{statusError}</div>}

      {!statusError && status && !ready && (
        <div className="panel ai-setup-card">
          <div className="ai-orb" aria-hidden="true">✦</div>
          <div>
            <h2>{t('ai.setupTitle')}</h2>
            <p>{t('ai.setupDescription')}</p>
          </div>
        </div>
      )}

      <div className="ai-chat-shell">
        <div className="ai-thread" aria-live="polite">
          {messages.length === 0 && ready && (
            <div className="ai-welcome">
              <div className="ai-orb large" aria-hidden="true">✦</div>
              <h2>{t('ai.welcomeTitle')}</h2>
              <p>{t('ai.welcomeDescription')}</p>
              <div className="ai-starters">
                {STARTER_KEYS.map((key) => (
                  <button
                    key={key}
                    className="ai-starter"
                    type="button"
                    onClick={() => sendMessage(t(key))}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <article key={`${message.role}-${index}`} className={`ai-message ${message.role}`}>
              <div className="ai-message-label">
                {message.role === 'assistant' ? t('ai.assistantName') : t('ai.you')}
              </div>
              <div className="ai-message-body">{message.content}</div>
              {message.role === 'assistant' && message.operations?.length > 0 && (
                <div className="ai-operation-list" aria-label={t('ai.operations')}>
                  {message.operations.map((operation, operationIndex) => (
                    <span
                      key={`${operation.operation}-${operation.collection || ''}-${operationIndex}`}
                      className={`ai-operation ${operation.success ? 'success' : 'failed'}`}
                    >
                      <span aria-hidden="true">{operation.success ? '✓' : '!'}</span>
                      {operationText(operation, t)}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}

          {sending && (
            <article className="ai-message assistant ai-thinking">
              <div className="ai-message-label">{t('ai.assistantName')}</div>
              <div className="ai-thinking-dots" aria-label={t('ai.thinking')}>
                <span />
                <span />
                <span />
              </div>
            </article>
          )}
          <div ref={endRef} />
        </div>

        <div className="ai-composer-shell">
          {error && <div className="error-banner ai-banner" role="alert">{error}</div>}
          {status?.writes_available && (
            <label className="ai-write-toggle">
              <input
                type="checkbox"
                checked={allowWrites}
                disabled={sending || !ready}
                onChange={(event) => setAllowWrites(event.target.checked)}
              />
              <span>
                <strong>{t('ai.allowChanges')}</strong>
                <small>{t('ai.allowChangesHint')}</small>
              </span>
            </label>
          )}
          <div className="ai-composer">
            <textarea
              rows="3"
              value={draft}
              disabled={sending || !ready}
              placeholder={ready ? t('ai.placeholder') : t('ai.disabledPlaceholder')}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="primary-button ai-send-button"
              type="button"
              disabled={sending || !ready || !draft.trim()}
              onClick={() => sendMessage()}
            >
              {sending ? t('ai.sending') : t('ai.send')}
            </button>
          </div>
          <small className="ai-composer-hint">{t('ai.composerHint')}</small>
        </div>
      </div>
    </section>
  );
}

export { operationText };
