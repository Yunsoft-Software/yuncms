import { useEffect, useRef, useState } from 'react';

export function DataViewOptions({
  columns = [],
  visibleKeys = [],
  density = 'comfortable',
  onToggleColumn,
  onDensityChange,
  labels = {},
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

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
        {labels.trigger || 'View'}
      </button>
      {open && (
        <div className="data-view-options-popover" role="dialog" aria-label={labels.title || labels.trigger || 'View options'}>
          <section>
            <strong>{labels.columns || 'Columns'}</strong>
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
            <strong>{labels.density || 'Density'}</strong>
            <div className="data-view-density" role="group" aria-label={labels.density || 'Density'}>
              {[
                ['compact', labels.compact || 'Compact'],
                ['comfortable', labels.comfortable || 'Comfortable'],
                ['relaxed', labels.relaxed || 'Relaxed'],
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
