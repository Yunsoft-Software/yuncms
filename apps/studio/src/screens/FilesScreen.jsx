import { useEffect, useMemo, useState } from 'react';

import { apiBlob, apiRequest } from '../api.js';
import { useConfirmDialog } from '../components/DialogProvider.jsx';
import { FilePreview } from '../components/FilePreview.jsx';
import { FilePreviewModal } from '../components/FilePreviewModal.jsx';
import { Pagination, paginateClientItems } from '../components/Pagination.jsx';
import { useI18n } from '../i18n.js';

const FILE_TYPE_OPTIONS = [
  ['all', 'files.allTypes'],
  ['image', 'files.images'],
  ['video', 'files.video'],
  ['audio', 'files.audio'],
  ['pdf', 'files.pdf'],
  ['other', 'files.other'],
];

const FILE_SORT_OPTIONS = [
  ['newest', 'files.newest'],
  ['oldest', 'files.oldest'],
  ['name-asc', 'files.nameAsc'],
  ['name-desc', 'files.nameDesc'],
  ['size-desc', 'files.sizeDesc'],
  ['size-asc', 'files.sizeAsc'],
];

const FILE_PAGE_SIZES = [12, 24, 48, 96];

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileExtension(file) {
  const filename = file.filename_download || '';
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

function fileTypeLabel(file, t) {
  const mimetype = file.mimetype || 'application/octet-stream';
  if (mimetype.startsWith('image/')) return t('files.image');
  if (mimetype.startsWith('video/')) return t('files.video');
  if (mimetype.startsWith('audio/')) return t('files.audio');
  if (mimetype === 'application/pdf') return t('files.pdf');
  const extension = fileExtension(file);
  return extension ? extension.toUpperCase() : t('files.file');
}

function fileCategory(file) {
  const mimetype = (file.mimetype || '').toLowerCase();
  const extension = fileExtension(file);
  if (mimetype.startsWith('image/') || ['avif', 'bmp', 'gif', 'heic', 'heif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(extension)) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype === 'application/pdf' || extension === 'pdf') return 'pdf';
  return 'other';
}

function fileDisplayName(file, t) {
  return file.title || file.filename_download || t('files.untitled');
}

function compareFiles(left, right, sort, t) {
  if (sort === 'newest' || sort === 'oldest') {
    const leftTime = left.uploaded_at ? new Date(left.uploaded_at).getTime() : 0;
    const rightTime = right.uploaded_at ? new Date(right.uploaded_at).getTime() : 0;
    return sort === 'newest' ? rightTime - leftTime : leftTime - rightTime;
  }
  if (sort === 'size-desc' || sort === 'size-asc') {
    const difference = Number(left.filesize || 0) - Number(right.filesize || 0);
    return sort === 'size-desc' ? -difference : difference;
  }
  const result = fileDisplayName(left, t).localeCompare(fileDisplayName(right, t), undefined, { sensitivity: 'base' });
  return sort === 'name-desc' ? -result : result;
}

export function FilesScreen() {
  const { locale, t } = useI18n();
  const requestConfirmation = useConfirmDialog();
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [view, setView] = useState('grid');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [showUpload, setShowUpload] = useState(false);
  const [editingFile, setEditingFile] = useState(null);
  const [editForm, setEditForm] = useState({ filenameDownload: '', title: '' });
  const [dropActive, setDropActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await apiRequest('/files');
      setFiles(response?.data ?? []);
    } catch (requestError) {
      setError(requestError.message || t('files.loadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const visibleFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return files
      .filter((file) => typeFilter === 'all' || fileCategory(file) === typeFilter)
      .filter((file) => !query || [file.title, file.filename_download, file.mimetype, file.storage]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)))
      .slice()
      .sort((left, right) => compareFiles(left, right, sort, t));
  }, [files, search, sort, typeFilter, t]);

  const paged = useMemo(() => paginateClientItems(visibleFiles, page, pageSize), [page, pageSize, visibleFiles]);
  const pageFiles = paged.items;
  const hasActiveFilters = Boolean(search.trim() || typeFilter !== 'all' || sort !== 'newest');

  useEffect(() => {
    setPage(1);
  }, [search, sort, typeFilter]);

  async function upload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!selectedFile) return;
    setUploading(true);
    setError('');
    setNotice('');
    try {
      await apiRequest('/files', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-filename': encodeURIComponent(selectedFile.name),
          'x-mimetype': selectedFile.type || 'application/octet-stream',
        },
        body: selectedFile,
      });
      setSelectedFile(null);
      form.reset();
      setShowUpload(false);
      setPage(1);
      setNotice(t('files.uploadedNotice'));
      await load();
    } catch (requestError) {
      setError(requestError.message || t('files.uploadError'));
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDropActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) setSelectedFile(file);
  }

  async function download(file) {
    setError('');
    try {
      const blob = await apiBlob(`/files/${encodeURIComponent(file.id)}/content`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename_download;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (requestError) {
      setError(requestError.message || t('files.downloadError'));
    }
  }

  function beginEdit(file) {
    setEditingFile(file);
    setEditForm({ filenameDownload: file.filename_download || '', title: file.title || '' });
    setError('');
    setNotice('');
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editingFile || !editForm.filenameDownload.trim()) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/files/${encodeURIComponent(editingFile.id)}`, {
        method: 'PATCH',
        body: {
          filenameDownload: editForm.filenameDownload.trim(),
          title: editForm.title.trim() || null,
        },
      });
      setEditingFile(null);
      setNotice(t('files.updatedNotice'));
      await load();
    } catch (requestError) {
      setError(requestError.message || t('files.updateError'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(file) {
    const accepted = await requestConfirmation({
      title: t('files.deleteTitle'),
      description: t('files.deleteDescription', { file: file.filename_download }),
      confirmLabel: t('files.deleteFile'),
      tone: 'danger',
    });
    if (!accepted) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(`/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
      if (editingFile?.id === file.id) setEditingFile(null);
      if (previewFile?.id === file.id) setPreviewFile(null);
      setNotice(t('files.deletedNotice'));
      await load();
    } catch (requestError) {
      setError(requestError.message || t('files.deleteError'));
    }
  }

  function resetControls() {
    setSearch('');
    setTypeFilter('all');
    setSort('newest');
    setPage(1);
  }

  const dateLocale = locale === 'tr' ? 'tr-TR' : 'en-US';

  return (
    <div className="screen-stack">
      <section className="panel library-toolbar workspace-toolbar library-header-panel">
        <div className="workspace-toolbar-heading">
          <div>
            <p className="eyebrow">{t('nav.files')}</p>
            <h2>{t('nav.files')}</h2>
            <p>{files.length === 0 ? t('files.libraryEmptyDescription') : t('files.libraryCount', { count: files.length })}</p>
          </div>
          <div className="workspace-toolbar-actions">
            <div className="segmented-control" aria-label={t('files.view')}>
              <button className={view === 'grid' ? 'active' : ''} type="button" onClick={() => setView('grid')}>{t('files.gallery')}</button>
              <button className={view === 'list' ? 'active' : ''} type="button" onClick={() => setView('list')}>{t('files.list')}</button>
            </div>
            <button className="primary-button" type="button" onClick={() => setShowUpload((value) => !value)}>
              {showUpload ? t('files.closeUpload') : t('files.uploadFile')}
            </button>
          </div>
        </div>

        <div className="list-controls file-list-controls">
          <label className="field-label">
            <span>{t('common.search')}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('files.searchPlaceholder')}
              aria-label={t('files.searchFiles')}
            />
          </label>
          <label className="field-label">
            <span>{t('files.fileType')}</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              {FILE_TYPE_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
            </select>
          </label>
          <label className="field-label">
            <span>{t('common.sort')}</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              {FILE_SORT_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
            </select>
          </label>
          <div className="list-controls-summary">
            <span className="result-count">{t('files.matchingCount', { count: visibleFiles.length })}</span>
            {hasActiveFilters && <button className="text-button" type="button" onClick={resetControls}>{t('common.reset')}</button>}
          </div>
        </div>
      </section>

      {showUpload && (
        <form className="panel file-upload-panel file-upload-compact" onSubmit={upload}>
          <div>
            <p className="eyebrow">{t('files.upload')}</p>
            <h2>{t('files.addFile')}</h2>
            <p>{t('files.dropDescription')}</p>
          </div>
          <div
            className={`file-dropzone ${dropActive ? 'active' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDropActive(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDropActive(false)}
            onDrop={handleDrop}
          >
            <input
              id="file-upload-input"
              type="file"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
            <label htmlFor="file-upload-input" className="file-picker-label">
              <strong>{selectedFile ? selectedFile.name : t('files.chooseFile')}</strong>
              <span>{selectedFile ? formatBytes(selectedFile.size) : t('files.dragDrop')}</span>
            </label>
            <button className="primary-button" type="submit" disabled={!selectedFile || uploading}>
              {uploading ? t('files.uploading') : t('files.upload')}
            </button>
          </div>
        </form>
      )}

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      {editingFile && (
        <form className="panel form-panel file-editor" onSubmit={saveEdit}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{t('files.fileDetails')}</p>
              <h2>{fileDisplayName(editingFile, t)}</h2>
              <p>{t('files.editDescription')}</p>
            </div>
            <button className="text-button" type="button" onClick={() => setEditingFile(null)}>{t('common.close')}</button>
          </div>
          <div className="form-grid">
            <label className="field-label">
              <span>{t('files.title')}</span>
              <input
                value={editForm.title}
                onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))}
                placeholder={t('files.optionalTitle')}
              />
            </label>
            <label className="field-label">
              <span>{t('files.downloadFilename')}</span>
              <input
                value={editForm.filenameDownload}
                onChange={(event) => setEditForm((current) => ({ ...current, filenameDownload: event.target.value }))}
                required
              />
            </label>
          </div>
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={saving}>{saving ? t('common.saving') : t('files.saveChanges')}</button>
          </div>
        </form>
      )}

      {loading ? (
        <section className="panel"><p>{t('files.loading')}</p></section>
      ) : visibleFiles.length === 0 ? (
        <section className="panel empty-state empty-state-action">
          <div>
            <h2>{files.length === 0 ? t('files.noFilesYet') : t('files.noMatchingFiles')}</h2>
            <p>{files.length === 0 ? t('files.emptyDescription') : t('files.noMatchDescription')}</p>
          </div>
          {files.length === 0 ? (
            <button className="primary-button" type="button" onClick={() => setShowUpload(true)}>{t('files.uploadFirst')}</button>
          ) : (
            <button className="text-button" type="button" onClick={resetControls}>{t('common.resetFilters')}</button>
          )}
        </section>
      ) : view === 'grid' ? (
        <section className="file-library-results">
          <div className="file-grid" aria-label={t('files.fileGallery')}>
            {pageFiles.map((file) => (
              <article className="file-card" key={file.id}>
                <div className="file-preview">
                  <button
                    className="file-preview-open-button"
                    type="button"
                    onClick={() => setPreviewFile(file)}
                    aria-label={t('files.openPreview', { file: fileDisplayName(file, t) })}
                  >
                    <FilePreview file={file} label={fileTypeLabel(file, t)} alt={fileDisplayName(file, t)} />
                  </button>
                </div>
                <div className="file-card-body">
                  <div className="file-card-title">
                    <strong title={fileDisplayName(file, t)}>{fileDisplayName(file, t)}</strong>
                    <small title={file.filename_download}>{file.filename_download}</small>
                  </div>
                  <div className="file-meta-row">
                    <span>{fileTypeLabel(file, t)}</span>
                    <span>{formatBytes(file.filesize)}</span>
                  </div>
                  <div className="file-card-actions">
                    <button className="text-button" type="button" onClick={() => setPreviewFile(file)}>{t('files.preview')}</button>
                    <button className="text-button" type="button" onClick={() => download(file)}>{t('files.download')}</button>
                    <button className="text-button" type="button" onClick={() => beginEdit(file)}>{t('common.edit')}</button>
                    <button className="danger-button" type="button" onClick={() => remove(file)}>{t('common.delete')}</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <Pagination
            page={paged.page}
            pageSize={pageSize}
            totalItems={visibleFiles.length}
            pageSizeOptions={FILE_PAGE_SIZES}
            itemLabel={t('files.files')}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </section>
      ) : (
        <section className="table-panel">
          <div className="table-scroll">
            <table>
              <thead><tr><th>{t('common.name')}</th><th>{t('common.type')}</th><th>{t('files.size')}</th><th>{t('files.storage')}</th><th>{t('files.uploaded')}</th><th /></tr></thead>
              <tbody>
                {pageFiles.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <div className="file-list-name">
                        <button className="file-list-thumb file-preview-open-button" type="button" onClick={() => setPreviewFile(file)} aria-label={t('files.openPreview', { file: fileDisplayName(file, t) })}>
                          <FilePreview file={file} label={fileTypeLabel(file, t)} />
                        </button>
                        <span><strong>{fileDisplayName(file, t)}</strong><small>{file.filename_download}</small></span>
                      </div>
                    </td>
                    <td>{file.mimetype || fileTypeLabel(file, t)}</td>
                    <td>{formatBytes(file.filesize)}</td>
                    <td>{file.storage}</td>
                    <td>{file.uploaded_at ? new Date(file.uploaded_at).toLocaleString(dateLocale) : '—'}</td>
                    <td className="row-actions">
                      <button className="text-button" type="button" onClick={() => setPreviewFile(file)}>{t('files.preview')}</button>
                      <button className="text-button" type="button" onClick={() => download(file)}>{t('files.download')}</button>
                      <button className="text-button" type="button" onClick={() => beginEdit(file)}>{t('common.edit')}</button>
                      <button className="danger-button" type="button" onClick={() => remove(file)}>{t('common.delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={paged.page}
            pageSize={pageSize}
            totalItems={visibleFiles.length}
            pageSizeOptions={FILE_PAGE_SIZES}
            itemLabel={t('files.files')}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </section>
      )}

      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
