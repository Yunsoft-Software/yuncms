import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function ActionMenu({ label, items = [], align = 'end' }) {
  const menuId = useId();
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, right: 'auto' });

  function positionMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (align === 'start') {
      setPosition({ top: rect.bottom + 5, left: Math.max(8, rect.left), right: 'auto' });
      return;
    }
    setPosition({
      top: rect.bottom + 5,
      left: 'auto',
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }

  function openMenu({ focusFirst = false } = {}) {
    positionMenu();
    setOpen(true);
    if (focusFirst) {
      window.requestAnimationFrame(() => menuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus());
    }
  }

  function closeMenu({ restoreFocus = false } = {}) {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      closeMenu();
    };
    const closeOnViewportChange = () => closeMenu();
    document.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [open]);

  function handleTriggerKeyDown(event) {
    if (!['ArrowDown', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    openMenu({ focusFirst: true });
  }

  function handleMenuKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const options = [...menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    if (options.length === 0) return;
    const currentIndex = options.indexOf(document.activeElement);
    if (event.key === 'Home') options[0].focus();
    else if (event.key === 'End') options.at(-1).focus();
    else if (event.key === 'ArrowDown') options[(currentIndex + 1 + options.length) % options.length].focus();
    else options[(currentIndex - 1 + options.length) % options.length].focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="action-menu-trigger"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="action-menu-popover"
          role="menu"
          aria-label={label}
          style={position}
          onKeyDown={handleMenuKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              className={`action-menu-item ${item.tone === 'danger' ? 'danger' : ''}`}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                closeMenu();
                item.onSelect?.();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
