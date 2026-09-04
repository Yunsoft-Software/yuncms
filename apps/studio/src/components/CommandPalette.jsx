import { useEffect, useMemo, useRef, useState } from 'react';

import { SidebarIcon } from './SidebarIcon.jsx';

export function CommandPalette({ commands, open, onClose, onInvoke, label, placeholder, emptyLabel }) {
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const visibleCommands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) => command.label.toLocaleLowerCase().includes(normalized));
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (activeIndex < visibleCommands.length) return;
    setActiveIndex(Math.max(0, visibleCommands.length - 1));
  }, [activeIndex, visibleCommands.length]);

  if (!open) return null;

  function invoke(command) {
    if (!command) return;
    onClose();
    onInvoke(command);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' && visibleCommands.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % visibleCommands.length);
      return;
    }
    if (event.key === 'ArrowUp' && visibleCommands.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + visibleCommands.length) % visibleCommands.length);
      return;
    }
    if (event.key === 'Enter' && document.activeElement === inputRef.current) {
      event.preventDefault();
      invoke(visibleCommands[activeIndex]);
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...dialogRef.current.querySelectorAll('input, button:not(:disabled)')];
    if (focusable.length === 0) return;
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

  return (
    <div
      className="studio-command-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <section
        className="studio-command-palette"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <div className="studio-command-search">
          <SidebarIcon name="content" size={16} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            placeholder={placeholder}
            aria-label={label}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="studio-command-results">
          {visibleCommands.map((command, index) => (
            <button
              className={`studio-command-item ${index === activeIndex ? 'active' : ''}`}
              type="button"
              key={command.id}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => invoke(command)}
            >
              <SidebarIcon name={command.icon} size={17} />
              <span>{command.label}</span>
            </button>
          ))}
          {visibleCommands.length === 0 && <p className="studio-command-empty">{emptyLabel}</p>}
        </div>
        <footer className="studio-command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd></span>
          <span><kbd>Enter</kbd></span>
        </footer>
      </section>
    </div>
  );
}
