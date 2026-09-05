import { useMemo, useState } from 'react';

import { useI18n } from '../i18n.js';

export function RelationPicker({
  value = '',
  items = [],
  keyField = 'id',
  labelField = 'name',
  required = false,
  disabled = false,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  noneLabel,
  onChange,
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const resolvedPlaceholder = placeholder || t('content.chooseRecord');
  const resolvedSearchPlaceholder = searchPlaceholder || t('content.relationSearch');
  const resolvedEmptyLabel = emptyLabel || t('content.relationEmpty');
  const resolvedNoneLabel = noneLabel || t('common.none');

  const selected = useMemo(
    () => items.find((item) => String(item?.[keyField]) === String(value)) ?? null,
    [items, keyField, value],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => {
      const key = item?.[keyField];
      const label = item?.[labelField];
      return [key, label]
        .filter((entry) => entry != null)
        .some((entry) => String(entry).toLowerCase().includes(normalized));
    });
  }, [items, keyField, labelField, query]);

  const selectedLabel = selected?.[labelField] ?? selected?.[keyField] ?? value;

  function choose(nextValue) {
    onChange?.(nextValue);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className={`relation-picker ${open ? 'open' : ''}`}>
      <button
        className="relation-picker-trigger"
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selectedLabel ? '' : 'placeholder'}>{selectedLabel || resolvedPlaceholder}</span>
        <span aria-hidden="true">⌄</span>
      </button>

      {open && (
        <div className="relation-picker-popover">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={resolvedSearchPlaceholder}
            autoFocus
          />
          <div className="relation-picker-options" role="listbox">
            {!required && (
              <button
                className={!value ? 'active' : ''}
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => choose('')}
              >
                {resolvedNoneLabel}
              </button>
            )}
            {filtered.map((item) => {
              const itemValue = item?.[keyField];
              const itemLabel = item?.[labelField] ?? itemValue;
              const active = String(itemValue) === String(value);
              return (
                <button
                  className={active ? 'active' : ''}
                  type="button"
                  role="option"
                  aria-selected={active}
                  key={String(itemValue)}
                  onClick={() => choose(String(itemValue))}
                >
                  <span>{String(itemLabel)}</span>
                  {String(itemLabel) !== String(itemValue) && <small>{String(itemValue)}</small>}
                </button>
              );
            })}
            {filtered.length === 0 && <p className="relation-picker-empty">{resolvedEmptyLabel}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
