import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { useI18n } from '../i18n.js';
import { Modal } from './Modal.jsx';

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);
  const cancelButtonRef = useRef(null);

  const settle = useCallback((accepted) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    resolve?.(accepted);
  }, []);

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolverRef.current?.(false);
    resolverRef.current = resolve;
    setDialog({
      title: options.title,
      description: options.description || '',
      confirmLabel: options.confirmLabel || t('common.confirm'),
      cancelLabel: options.cancelLabel || t('common.cancel'),
      tone: options.tone || 'primary',
    });
  }), [t]);

  useEffect(() => () => resolverRef.current?.(false), []);

  return (
    <DialogContext.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(dialog)}
        title={dialog?.title}
        description={dialog?.description}
        onClose={() => settle(false)}
        initialFocusRef={cancelButtonRef}
        actions={dialog && (
          <>
            <button ref={cancelButtonRef} className="text-button" type="button" onClick={() => settle(false)}>
              {dialog.cancelLabel}
            </button>
            <button
              className={dialog.tone === 'danger' ? 'danger-button' : 'primary-button'}
              type="button"
              onClick={() => settle(true)}
            >
              {dialog.confirmLabel}
            </button>
          </>
        )}
      />
    </DialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const confirm = useContext(DialogContext);
  if (!confirm) throw new Error('useConfirmDialog must be used inside DialogProvider');
  return confirm;
}
