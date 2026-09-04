import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Inspector({ open, title, description, children, actions, onClose, className = '' }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector(FOCUSABLE_SELECTOR) || panelRef.current;
      target?.focus?.();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR)];
    if (focusable.length === 0) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="studio-inspector-layer">
      <button className="studio-inspector-scrim" type="button" aria-label="Close inspector" onClick={onClose} />
      <aside
        ref={panelRef}
        className={`studio-inspector ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="studio-inspector-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button className="text-button studio-inspector-close" type="button" onClick={onClose} aria-label="Close inspector">×</button>
        </header>
        <div className="studio-inspector-body">{children}</div>
        {actions && <footer className="studio-inspector-actions">{actions}</footer>}
      </aside>
    </div>,
    document.body,
  );
}
