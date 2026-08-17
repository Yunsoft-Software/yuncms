import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import { useI18n } from '../i18n.js';
import { FilePreview } from './FilePreview.jsx';

function isImage(file) {
  return String(file?.mimetype || '').toLowerCase().startsWith('image/');
}

function fileLabel(file) {
  return file?.title || file?.filename_download || file?.id || '';
}

export function LogoFilePicker({ value = null, onChange }) {
  const { t } = useI18n();
  const [files, setFiles] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiRequest('/files')
      .then((response) => {
        if (!cancelled) setFiles((response?.data ?? []).filter(isImage));
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message || t('appearance.logoFilesLoadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [t]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return files;
    return files.filter((file) => [file.title, file.filename_download, file.mimetype]
      .filter(Boolean)
      .some((entry) => String(entry).toLowerCase().includes(query)));
  }, [files, search]);

  const selected = files.find((file) => file.id === value) ?? null;

  return (
    <div className="logo-file-picker">
      <div className="logo-file-picker-heading">
        <div>
          <strong>{t('appearance.logoFromFiles')}</strong>
          <p>{t('appearance.logoFromFilesHint')}</p>
        </div>
        {value && (
          <button className="text-button" type="button" onClick={() => onChange(null)}>
            {t('appearance.useDefaultLogo')}
          </button>
        )}
      </div>

      {selected && (
        <div className="logo-file-selected">
          <span className="logo-file-selected-preview"><FilePreview file={selected} alt="" /></span>
          <span><strong>{fileLabel(selected)}</strong><small>{selected.mimetype}</small></span>
          <span className="status-pill">{t('appearance.selectedLogo')}</span>
        </div>
      )}

      <label className="field-label logo-file-search">
        <span>{t('common.search')}</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('appearance.searchLogoFiles')}
        />
      </label>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {loading ? (
        <p className="muted-line">{t('appearance.loadingLogoFiles')}</p>
      ) : filtered.length === 0 ? (
        <div className="inline-info">{t('appearance.noLogoFiles')}</div>
      ) : (
        <div className="logo-file-grid" role="list" aria-label={t('appearance.logoFromFiles')}>
          {filtered.map((file) => (
            <button
              className={`logo-file-option ${file.id === value ? 'active' : ''}`}
              type="button"
              key={file.id}
              onClick={() => onChange(file.id)}
              aria-pressed={file.id === value}
            >
              <span className="logo-file-thumb"><FilePreview file={file} alt="" /></span>
              <span className="logo-file-copy"><strong>{fileLabel(file)}</strong><small>{file.mimetype}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
