import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import { useI18n } from '../i18n.js';
import { FilePreview } from './FilePreview.jsx';
import { Modal } from './Modal.jsx';
import { Pagination, paginateClientItems } from './Pagination.jsx';

const PAGE_SIZE = 12;

function isImage(file) {
  return String(file?.mimetype || '').toLowerCase().startsWith('image/');
}

function fileLabel(file) {
  return file?.title || file?.filename_download || file?.id || '';
}

export function FilePickerModal({
  open,
  value = null,
  title,
  description,
  onClose,
  onSelect,
  imagesOnly = false,
}) {
  const { t } = useI18n();
  const [files, setFiles] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState(value);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setPending(value);
    setSearch('');
    setPage(1);
    setLoading(true);
    setError('');
    apiRequest('/files')
      .then((response) => {
        if (cancelled) return;
        const rows = response?.data ?? [];
        setFiles(imagesOnly ? rows.filter(isImage) : rows);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message || t('filePicker.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [imagesOnly, open, t, value]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return files;
    return files.filter((file) => [file.title, file.filename_download, file.mimetype]
      .filter(Boolean)
      .some((entry) => String(entry).toLowerCase().includes(query)));
  }, [files, search]);
  const paged = useMemo(() => paginateClientItems(filtered, page, PAGE_SIZE), [filtered, page]);

  useEffect(() => setPage(1), [search]);

  return (
    <Modal
      open={open}
      title={title || t('filePicker.title')}
      description={description || t('filePicker.description')}
      eyebrow={t('nav.files')}
      className="file-picker-modal"
      onClose={onClose}
      actions={(
        <>
          <button className="text-button" type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="primary-button"
            type="button"
            disabled={!pending}
            onClick={() => {
              const selected = files.find((file) => file.id === pending) ?? null;
              if (selected) onSelect(selected);
            }}
          >
            {t('filePicker.useSelected')}
          </button>
        </>
      )}
    >
      <label className="field-label file-picker-search">
        <span>{t('common.search')}</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('filePicker.searchPlaceholder')}
          autoFocus
        />
      </label>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {loading ? (
        <p className="muted-line">{t('filePicker.loading')}</p>
      ) : filtered.length === 0 ? (
        <div className="inline-info">{t(imagesOnly ? 'filePicker.noImages' : 'filePicker.noFiles')}</div>
      ) : (
        <>
          <div className="file-picker-grid" role="listbox" aria-label={title || t('filePicker.title')}>
            {paged.items.map((file) => (
              <button
                className={`file-picker-option ${pending === file.id ? 'active' : ''}`}
                type="button"
                role="option"
                aria-selected={pending === file.id}
                key={file.id}
                onClick={() => setPending(file.id)}
              >
                <span className="file-picker-thumb"><FilePreview file={file} alt="" /></span>
                <span className="file-picker-copy">
                  <strong title={fileLabel(file)}>{fileLabel(file)}</strong>
                  <small>{file.mimetype || t('files.file')}</small>
                </span>
              </button>
            ))}
          </div>
          <Pagination
            compact
            page={paged.page}
            pageSize={PAGE_SIZE}
            totalItems={filtered.length}
            itemLabel={t('files.files')}
            onPageChange={setPage}
          />
        </>
      )}
    </Modal>
  );
}

export { isImage as isImageFile };
