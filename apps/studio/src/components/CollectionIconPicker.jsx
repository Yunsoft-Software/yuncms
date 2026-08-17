import { useMemo, useState } from 'react';

import { findCollectionIcons, normalizeCollectionIcon } from '../collection-icons.js';
import { useI18n } from '../i18n.js';
import { CollectionIcon } from './CollectionIcon.jsx';

export function CollectionIconPicker({ value, onChange }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const normalized = normalizeCollectionIcon(value);
  const icons = useMemo(() => findCollectionIcons(search), [search]);

  return (
    <div className="collection-icon-picker">
      <label className="field-label">
        <span>{t('dataModel.collectionIcon')}</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('dataModel.searchIcons')}
        />
      </label>
      <div className="collection-icon-grid" role="listbox" aria-label={t('dataModel.collectionIcon')}>
        {icons.map((icon) => (
          <button
            type="button"
            key={icon.id}
            className={`collection-icon-option ${normalized === icon.id ? 'active' : ''}`}
            onClick={() => onChange(icon.id)}
            aria-selected={normalized === icon.id}
            role="option"
            title={icon.label}
          >
            <CollectionIcon name={icon.id} size={20} />
            <span>{icon.label}</span>
          </button>
        ))}
      </div>
      {icons.length === 0 && <div className="inline-info">{t('dataModel.noIcons')}</div>}
    </div>
  );
}
