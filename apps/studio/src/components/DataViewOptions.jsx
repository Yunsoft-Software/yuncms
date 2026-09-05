import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../i18n.js';

export function DataViewOptions({
  columns = [],
  visibleKeys = [],
  density = 'comfortable',
  onToggleColumn,
  onDensityChange,
  labels = {},
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerLabel = labels.trigger || t('content.viewOptions');
  const titleLabel = labels.title || labels.trigger || t('content.viewOptionsTitle');
  const columnsLabel = labels.columns || t('content.columns');
  const densityLabel = labels.density || t('content.density');

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutsidePointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="data-view-options" ref={rootRef}>
      <button
        className="secondary-button data-view-options-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {triggerLabel}
      </button>
      {open && (
        <div className="data-view-options-popover" role="dialog" aria-label={titleLabel}>
          <section>
            <strong>{columnsLabel}</strong>
            <div className="data-view-column-list">
              {columns.map((column) => {
                const checked = visibleKeys.includes(column.key);
                const onlyVisible = checked && visibleKeys.length <= 1;
                return (
                  <label key={column.key}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={onlyVisible}
                      onChange={() => onToggleColumn?.(column.key)}
                    />
                    <span>{column.label}</span>
                    {column.secondary && <small>{column.secondary}</small>}
                  </label>
                );
              })}
            </div>
          </section>
          <section>
            <strong>{densityLabel}</strong>
            <div className="data-view-density" role="group" aria-label={densityLabel}>
              {[
                ['compact', labels.compact || t('content.densityCompact')],
                ['comfortable', labels.comfortable || t('content.densityComfortable')],
                ['relaxed', labels.relaxed || t('content.densityRelaxed')],
              ].map(([value, label]) => (
                <button
                  className={density === value ? 'active' : ''}
                  type="button"
                  aria-pressed={density === value}
                  key={value}
                  onClick={() => onDensityChange?.(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
