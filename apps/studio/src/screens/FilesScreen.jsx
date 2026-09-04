import { useEffect, useMemo, useState } from 'react';

import { apiBlob, apiRequest } from '../api.js';
import {
  FileCategoryRail,
  FilePreview,
  Inspector,
  Pagination,
  UploadQueue,
  paginateClientItems,
  useConfirmDialog,
} from '../components/index.js';
import { useI18n } from '../i18n.js';
import { studioPath } from '../studio-route.js';

const FILE_TYPE_OPTIONS = [
  ['all', 'files.allTypes'],
  ['recent', 'files.recent'],
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
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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

function isRecentFile(file, now = Date.now()) {
  if (!file?.uploaded_at) return false;
  const uploadedAt = new Date(file.uploaded_at).getTime();
  if (!Number.isFinite(uploadedAt)) return false;
  return uploadedAt <= now && uploadedAt >= now - RECENT_WINDOW_MS;
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

function makeQueueItems(fileList) {
  const stamp = Date.now();
  return Array.from(fileList || []).map((file, index) => ({
    id: `${stamp}-${index}-${file.name}-${file.size}`,
    file,
    status: 'queued',
    error: '',
    sizeLabel: formatBytes(file.size),
  }));
}

export function FilesScreen({ route = {}, onNavigate }) {
  const { locale, t } = useI18n();
  const requestConfirmation = useConfirmDialog();
  const [files, setFiles] = useState([]);
  const [uploadQueue, setUploadQueue] = useState([]);
  const [inspectedFile, setInspectedFile] = useState(null);
  const [view, setView] = useState('grid');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
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
      const nextFiles = response?.data ?? [];
      setFiles(nextFiles);
      setInspectedFile((current) => {
        if (!current) return null;
        return nextFiles.find((file) => String(file.id) === String(current.id)) ?? null;
      });
    } catch (requestError) {
      setError(requestError.message || t('files.loadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const categoryCounts = useMemo(() => {
    const counts = { all: files.length, recent: 0, image: 0, video: 0, audio: 0, pdf: 0, other: 0 };
    const now = Date.now();
    files.forEach((file) => {
      counts[fileCategory(file)] += 1;
      if (isRecentFile(file, now)) counts.recent += 1;
    });
    return counts;
  }, [files]);

  const categoryItems = useMemo(() => FILE_TYPE_OPTIONS.map(([value, key]) => ({
    value,
    label: t(key),
    count: categoryCounts[value] || 0,
  })), [categoryCounts, t]);

  const visibleFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    const now = Date.now();
    return files
      .filter((file) => {
        if (typeFilter === 'all') return true;
        if (typeFilter === 'recent') return isRecentFile(file, now);
        return fileCategory(file) === typeFilter;
      })
      .filter((file) => !query || [file.title, file.filename_download, file.mimetype, file.storage]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)))
      .slice()
      .sort((left, right) => compareFiles(left, right, sort, t));
  }, [files, search, sort, typeFilter, t]);

  const paged = useMemo(() => paginateClientItems(visibleFiles, page, pageSize), [page, pageSize, visibleFiles]);
  const pageFiles = paged.items;
  const routedFile = files.find((file) => String(file.id) === String(route.fileId)) ?? null;
  const hasActiveFilters = Boolean(search.trim() || typeFilter !== 'all' || sort !== 'newest');
  const pendingUploads = uploadQueue.filter((item) => item.status === 'queued' || item.status === 'failed');
  const hasFailedUploads = uploadQueue.some((item) => item.status === 'failed');

  useEffect(() => {
    setPage(1);
  }, [search, sort, typeFilter]);

  function stageFiles(fileList) {
    const next = makeQueueItems(fileList);
    if (next.length === 0) return;
    setUploadQueue((current) => [...current, ...next]);
    setError('');
    setNotice('');
  }

  function updateQueueItem(id, patch) {
    setUploadQueue((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function removeQueueItem(id) {
    if (uploading) return;
    setUploadQueue((current) => current.filter((item) => item.id !== id));
  }

  async function upload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const targets = uploadQueue.filter((item) => item.status === 'queued' || item.status === 'failed');
    if (targets.length === 0) return;
    setUploading(true);
    setError('');
    setNotice('');
    let completed = 0;
    let failed = 0;

    for (const item of targets) {
      updateQueueItem(item.id, { status: 'uploading', error: '' });
      try {
        await apiRequest('/files', {
          method: 'POST',
          headers: {
            'content-type': 'application/octet-stream',
            'x-filename': encodeURIComponent(item.file.name),
            'x-mimetype': item.file.type || 'application/octet-stream',
          },
          body: item.file,
        });
        completed += 1;
        updateQueueItem(item.id, { status: 'done', error: '' });
      } catch (requestError) {
        failed += 1;
        updateQueueItem(item.id, {
          status: 'failed',
          error: requestError.message || t('files.uploadError'),
        });
      }
    }

    setUploading(false);
    if (completed > 0) {
      setPage(1);
      await load();
    }
    if (failed === 0) {
      setNotice(t('files.uploadedCount', { count: completed }));
      setUploadQueue([]);
      form.reset();
      onNavigate?.(studioPath.files());
    } else {
      setError(t('files.uploadPartial', { failed, count: targets.length }));
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDropActive(false);
    stageFiles(event.dataTransfer.files);
  }

  function handleLibraryDrop(event) {
    event.preventDefault();
    setDropActive(false);
    const dropped = event.dataTransfer.files;
    if (!dropped?.length) return;
    stageFiles(dropped);
    onNavigate?.(studioPath.newFile());
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
      if (inspectedFile?.id === file.id) setInspectedFile(null);
      setNotice(t('files.deletedNotice'));
      await load();
      if (route.view === 'detail') onNavigate?.(studioPath.files());
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

  if (route.view === 'new') {
    return (
      <div className="screen-stack routed-form-page">
        <nav className="page-breadcrumbs" aria-label={t('nav.files')}><button type="button" onClick={() => onNavigate?.(studioPath.files())}>{t('nav.files')}</button><span aria-hidden="true">/</span><strong>{t('files.addFile')}</strong></nav>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {notice && <div className="notice-banner" role="status">{notice}</div>}
        <form className="panel file-upload-panel file-upload-page" onSubmit={upload}>
          <div className="workspace-section-heading"><div><p className="eyebrow">{t('files.upload')}</p><h2>{t('files.addFile')}</h2><p>{t('files.dropDescription')}</p></div><button className="secondary-button" type="button" disabled={uploading} onClick={() => onNavigate?.(studioPath.files())}>{t('common.cancel')}</button></div>
          <div className={`file-dropzone ${dropActive ? 'active' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDropActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDropActive(false)} onDrop={handleDrop}>
            <input id="file-upload-page-input" type="file" multiple onChange={(event) => { stageFiles(event.target.files); event.target.value = ''; }} />
            <label htmlFor="file-upload-page-input" className="file-picker-label"><strong>{uploadQueue.length > 0 ? t('files.selectedFiles', { count: uploadQueue.length }) : t('files.chooseFile')}</strong><span>{t('files.dragDrop')}</span></label>
            <button className="primary-button" type="submit" disabled={pendingUploads.length === 0 || uploading}>{uploading ? t('files.uploading') : hasFailedUploads ? t('files.retryFailed') : t('files.uploadSelected')}</button>
          </div>
          <UploadQueue
            items={uploadQueue}
            onRemove={removeQueueItem}
            labels={{
              title: t('files.uploadQueue'),
              queued: t('files.queueQueued'),
              uploading: t('files.queueUploading'),
              done: t('files.queueDone'),
              failed: t('files.queueFailed'),
              remove: t('files.queueRemove'),
              untitled: t('files.untitled'),
            }}
          />
        </form>
      </div>
    );
  }

  if (route.view === 'detail') {
    return (
      <div className="screen-stack routed-form-page">
        <nav className="page-breadcrumbs" aria-label={t('nav.files')}><button type="button" onClick={() => onNavigate?.(studioPath.files())}>{t('nav.files')}</button><span aria-hidden="true">/</span><strong>{routedFile ? fileDisplayName(routedFile, t) : t('files.fileDetails')}</strong></nav>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {notice && <div className="notice-banner" role="status">{notice}</div>}
        {!routedFile ? (
          <section className="panel empty-state"><div><h2>{loading ? t('files.loading') : t('files.noFilesYet')}</h2></div></section>
        ) : (
          <section className="panel file-detail-page">
            <header className="file-detail-heading"><div><p className="eyebrow">{t('files.fileDetails')}</p><h2>{fileDisplayName(routedFile, t)}</h2><p>{routedFile.filename_download}</p></div><div className="file-detail-actions"><button className="secondary-button" type="button" onClick={() => download(routedFile)}>{t('files.download')}</button><button className="secondary-button" type="button" onClick={() => beginEdit(routedFile)}>{t('common.edit')}</button><button className="danger-button" type="button" onClick={() => remove(routedFile)}>{t('common.delete')}</button></div></header>
            <div className="file-detail-preview"><FilePreview file={routedFile} label={fileTypeLabel(routedFile, t)} alt={fileDisplayName(routedFile, t)} /></div>
            <div className="field-detail-grid"><article><small>{t('common.type')}</small><strong>{routedFile.mimetype || fileTypeLabel(routedFile, t)}</strong></article><article><small>{t('files.size')}</small><strong>{formatBytes(routedFile.filesize)}</strong></article><article><small>{t('files.storage')}</small><strong>{routedFile.storage}</strong></article><article><small>{t('files.uploaded')}</small><strong>{routedFile.uploaded_at ? new Date(routedFile.uploaded_at).toLocaleString(dateLocale) : '—'}</strong></article></div>
            {editingFile && <form className="schema-create-card form-stack file-detail-editor" onSubmit={saveEdit}><div><strong>{t('files.editDescription')}</strong></div><label className="field-label"><span>{t('files.title')}</span><input value={editForm.title} onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))} placeholder={t('files.optionalTitle')} /></label><label className="field-label"><span>{t('files.downloadFilename')}</span><input value={editForm.filenameDownload} onChange={(event) => setEditForm((current) => ({ ...current, filenameDownload: event.target.value }))} required /></label><div className="form-actions"><button className="secondary-button" type="button" onClick={() => setEditingFile(null)}>{t('common.cancel')}</button><button className="primary-button" type="submit" disabled={saving}>{saving ? t('common.saving') : t('files.saveChanges')}</button></div></form>}
          </section>
        )}
      </div>
    );
  }

  return (
    <div
      className={`screen-stack file-library-workspace ${dropActive ? 'drop-active' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setDropActive(true); }}
      onDragOver={(event) => { event.preventDefault(); setDropActive(true); }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDropActive(false);
      }}
      onDrop={handleLibraryDrop}
    >
      {dropActive && (
        <div className="file-library-drop-overlay" aria-hidden="true">
          <strong>{t('files.uploadFile')}</strong>
          <span>{t('files.dragDrop')}</span>
        </div>
      )}

      <FileCategoryRail
        items={categoryItems}
        value={typeFilter}
        label={t('files.categories')}
        onChange={(value) => {
          setTypeFilter(value);
          setPage(1);
        }}
      />

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
            <button className="primary-button" type="button" onClick={() => onNavigate?.(studioPath.newFile())}>{t('files.uploadFile')}</button>
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
          <label className="field-label file-type-fallback">
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

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      {loading ? (
        <section className="panel"><p>{t('files.loading')}</p></section>
      ) : visibleFiles.length === 0 ? (
        <section className="panel empty-state empty-state-action">
          <div>
            <h2>{files.length === 0 ? t('files.noFilesYet') : t('files.noMatchingFiles')}</h2>
            <p>{files.length === 0 ? t('files.emptyDescription') : t('files.noMatchDescription')}</p>
          </div>
          {files.length === 0 ? (
            <button className="primary-button" type="button" onClick={() => onNavigate?.(studioPath.newFile())}>{t('files.uploadFirst')}</button>
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
                  <button className="file-preview-open-button" type="button" onClick={() => setInspectedFile(file)} aria-label={t('files.openPreview', { file: fileDisplayName(file, t) })}>
                    <FilePreview file={file} label={fileTypeLabel(file, t)} alt={fileDisplayName(file, t)} />
                  </button>
                </div>
                <div className="file-card-body">
                  <div className="file-card-title"><strong title={fileDisplayName(file, t)}>{fileDisplayName(file, t)}</strong><small title={file.filename_download}>{file.filename_download}</small></div>
                  <div className="file-meta-row"><span>{fileTypeLabel(file, t)}</span><span>{formatBytes(file.filesize)}</span></div>
                  <div className="file-card-actions">
                    <button className="text-button" type="button" onClick={() => setInspectedFile(file)}>{t('files.preview')}</button>
                    <button className="text-button" type="button" onClick={() => download(file)}>{t('files.download')}</button>
                    <button className="text-button" type="button" onClick={() => { beginEdit(file); onNavigate?.(studioPath.file(file.id)); }}>{t('common.edit')}</button>
                    <button className="danger-button" type="button" onClick={() => remove(file)}>{t('common.delete')}</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <Pagination page={paged.page} pageSize={pageSize} totalItems={visibleFiles.length} pageSizeOptions={FILE_PAGE_SIZES} itemLabel={t('files.files')} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
        </section>
      ) : (
        <section className="table-panel">
          <div className="table-scroll">
            <table>
              <thead><tr><th>{t('common.name')}</th><th>{t('common.type')}</th><th>{t('files.size')}</th><th>{t('files.storage')}</th><th>{t('files.uploaded')}</th><th /></tr></thead>
              <tbody>
                {pageFiles.map((file) => (
                  <tr key={file.id}>
                    <td><div className="file-list-name"><button className="file-list-thumb file-preview-open-button" type="button" onClick={() => setInspectedFile(file)} aria-label={t('files.openPreview', { file: fileDisplayName(file, t) })}><FilePreview file={file} label={fileTypeLabel(file, t)} /></button><span><strong>{fileDisplayName(file, t)}</strong><small>{file.filename_download}</small></span></div></td>
                    <td>{file.mimetype || fileTypeLabel(file, t)}</td>
                    <td>{formatBytes(file.filesize)}</td>
                    <td>{file.storage}</td>
                    <td>{file.uploaded_at ? new Date(file.uploaded_at).toLocaleString(dateLocale) : '—'}</td>
                    <td className="row-actions"><button className="text-button" type="button" onClick={() => setInspectedFile(file)}>{t('files.preview')}</button><button className="text-button" type="button" onClick={() => download(file)}>{t('files.download')}</button><button className="text-button" type="button" onClick={() => { beginEdit(file); onNavigate?.(studioPath.file(file.id)); }}>{t('common.edit')}</button><button className="danger-button" type="button" onClick={() => remove(file)}>{t('common.delete')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={paged.page} pageSize={pageSize} totalItems={visibleFiles.length} pageSizeOptions={FILE_PAGE_SIZES} itemLabel={t('files.files')} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
        </section>
      )}

      <Inspector
        open={Boolean(inspectedFile)}
        title={inspectedFile ? fileDisplayName(inspectedFile, t) : t('files.fileDetails')}
        description={inspectedFile?.filename_download || ''}
        closeLabel={t('studio.inspectorClose')}
        onClose={() => setInspectedFile(null)}
        actions={inspectedFile && (<><button className="secondary-button" type="button" onClick={() => download(inspectedFile)}>{t('files.download')}</button><button className="primary-button" type="button" onClick={() => { const fileId = inspectedFile.id; setInspectedFile(null); onNavigate?.(studioPath.file(fileId)); }}>{t('files.fileDetails')}</button></>)}
      >
        {inspectedFile && <div className="file-inspector-content"><div className="file-inspector-preview"><FilePreview file={inspectedFile} label={fileTypeLabel(inspectedFile, t)} alt={fileDisplayName(inspectedFile, t)} /></div><dl className="file-inspector-meta"><div><dt>{t('common.type')}</dt><dd>{inspectedFile.mimetype || fileTypeLabel(inspectedFile, t)}</dd></div><div><dt>{t('files.size')}</dt><dd>{formatBytes(inspectedFile.filesize)}</dd></div><div><dt>{t('files.storage')}</dt><dd>{inspectedFile.storage || '—'}</dd></div><div><dt>{t('files.uploaded')}</dt><dd>{inspectedFile.uploaded_at ? new Date(inspectedFile.uploaded_at).toLocaleString(dateLocale) : '—'}</dd></div></dl></div>}
      </Inspector>
    </div>
  );
}

export { isRecentFile, makeQueueItems };
