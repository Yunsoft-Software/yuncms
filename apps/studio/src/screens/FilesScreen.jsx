import { useEffect, useMemo, useState } from 'react';

import { apiBlob, apiRequest } from '../api.js';
import { useConfirmDialog } from '../components/DialogProvider.jsx';
import { FilePreview } from '../components/FilePreview.jsx';
import { Pagination, paginateClientItems } from '../components/Pagination.jsx';

const FILE_TYPE_OPTIONS = [
  ['all', 'All types'],
  ['image', 'Images'],
  ['video', 'Video'],
  ['audio', 'Audio'],
  ['pdf', 'PDF'],
  ['other', 'Other'],
];

const FILE_SORT_OPTIONS = [
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['name-asc', 'Name A–Z'],
  ['name-desc', 'Name Z–A'],
  ['size-desc', 'Largest first'],
  ['size-asc', 'Smallest first'],
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

function fileTypeLabel(file) {
  const mimetype = file.mimetype || 'application/octet-stream';
  if (mimetype.startsWith('image/')) return 'Image';
  if (mimetype.startsWith('video/')) return 'Video';
  if (mimetype.startsWith('audio/')) return 'Audio';
  if (mimetype === 'application/pdf') return 'PDF';
  const extension = fileExtension(file);
  return extension ? extension.toUpperCase() : 'File';
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

function fileDisplayName(file) {
  return file.title || file.filename_download || 'Untitled file';
}

function compareFiles(left, right, sort) {
  if (sort === 'newest' || sort === 'oldest') {
    const leftTime = left.uploaded_at ? new Date(left.uploaded_at).getTime() : 0;
    const rightTime = right.uploaded_at ? new Date(right.uploaded_at).getTime() : 0;
    return sort === 'newest' ? rightTime - leftTime : leftTime - rightTime;
  }
  if (sort === 'size-desc' || sort === 'size-asc') {
    const difference = Number(left.filesize || 0) - Number(right.filesize || 0);
    return sort === 'size-desc' ? -difference : difference;
  }
  const result = fileDisplayName(left).localeCompare(fileDisplayName(right), undefined, { sensitivity: 'base' });
  return sort === 'name-desc' ? -result : result;
}

export function FilesScreen() {
  const requestConfirmation = useConfirmDialog();
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
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
      setError(requestError.message || 'Files could not be loaded');
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
      .filter((file) => !query || [
        file.title,
        file.filename_download,
        file.mimetype,
        file.storage,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)))
      .slice()
      .sort((left, right) => compareFiles(left, right, sort));
  }, [files, search, sort, typeFilter]);

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
      setNotice('File uploaded');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'File could not be uploaded');
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
      setError(requestError.message || 'File could not be downloaded');
    }
  }

  function beginEdit(file) {
    setEditingFile(file);
    setEditForm({
      filenameDownload: file.filename_download || '',
      title: file.title || '',
    });
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
      setNotice('File metadata updated');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'File metadata could not be updated');
    } finally {
      setSaving(false);
    }
  }

  async function remove(file) {
    const accepted = await requestConfirmation({
      title: 'Delete file?',
      description: `${file.filename_download} and its stored content will be permanently deleted.`,
      confirmLabel: 'Delete file',
      tone: 'danger',
    });
    if (!accepted) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(`/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
      if (editingFile?.id === file.id) setEditingFile(null);
      setNotice('File deleted');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'File could not be deleted');
    }
  }

  function resetControls() {
    setSearch('');
    setTypeFilter('all');
    setSort('newest');
    setPage(1);
  }

  return (
    <div className="screen-stack">
      <section className="panel library-toolbar workspace-toolbar library-header-panel">
        <div className="workspace-toolbar-heading">
          <div>
            <p className="eyebrow">Library</p>
            <h2>Files</h2>
            <p>{files.length === 0 ? 'Upload files and manage their metadata.' : `${files.length} files in the library.`}</p>
          </div>
          <div className="workspace-toolbar-actions">
            <div className="segmented-control" aria-label="File view">
              <button className={view === 'grid' ? 'active' : ''} type="button" onClick={() => setView('grid')}>Gallery</button>
              <button className={view === 'list' ? 'active' : ''} type="button" onClick={() => setView('list')}>List</button>
            </div>
            <button className="primary-button" type="button" onClick={() => setShowUpload((value) => !value)}>
              {showUpload ? 'Close upload' : 'Upload file'}
            </button>
          </div>
        </div>

        <div className="list-controls file-list-controls">
          <label className="field-label">
            <span>Search</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, MIME type or storage…"
              aria-label="Search files"
            />
          </label>
          <label className="field-label">
            <span>File type</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              {FILE_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field-label">
            <span>Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              {FILE_SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="list-controls-summary">
            <span className="result-count">{visibleFiles.length} matching</span>
            {hasActiveFilters && <button className="text-button" type="button" onClick={resetControls}>Reset</button>}
          </div>
        </div>
      </section>

      {showUpload && (
        <form className="panel file-upload-panel file-upload-compact" onSubmit={upload}>
          <div>
            <p className="eyebrow">Upload</p>
            <h2>Add a file</h2>
            <p>Drop one file here or choose it from your device.</p>
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
              <strong>{selectedFile ? selectedFile.name : 'Choose a file'}</strong>
              <span>{selectedFile ? formatBytes(selectedFile.size) : 'or drag and drop it here'}</span>
            </label>
            <button className="primary-button" type="submit" disabled={!selectedFile || uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
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
              <p className="eyebrow">File details</p>
              <h2>{fileDisplayName(editingFile)}</h2>
              <p>Edit the title and download filename without changing the stored file.</p>
            </div>
            <button className="text-button" type="button" onClick={() => setEditingFile(null)}>Close</button>
          </div>
          <div className="form-grid">
            <label className="field-label">
              <span>Title</span>
              <input
                value={editForm.title}
                onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Optional display title"
              />
            </label>
            <label className="field-label">
              <span>Download filename</span>
              <input
                value={editForm.filenameDownload}
                onChange={(event) => setEditForm((current) => ({ ...current, filenameDownload: event.target.value }))}
                required
              />
            </label>
          </div>
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <section className="panel"><p>Loading files…</p></section>
      ) : visibleFiles.length === 0 ? (
        <section className="panel empty-state empty-state-action">
          <div>
            <h2>{files.length === 0 ? 'No files yet' : 'No matching files'}</h2>
            <p>{files.length === 0 ? 'Upload the first file to start building your library.' : 'Try a broader search or reset the filters.'}</p>
          </div>
          {files.length === 0 ? (
            <button className="primary-button" type="button" onClick={() => setShowUpload(true)}>Upload first file</button>
          ) : (
            <button className="text-button" type="button" onClick={resetControls}>Reset filters</button>
          )}
        </section>
      ) : view === 'grid' ? (
        <section className="file-library-results">
          <div className="file-grid" aria-label="File gallery">
            {pageFiles.map((file) => (
              <article className="file-card" key={file.id}>
                <div className="file-preview">
                  <FilePreview file={file} label={fileTypeLabel(file)} alt={fileDisplayName(file)} />
                </div>
                <div className="file-card-body">
                  <div className="file-card-title">
                    <strong title={fileDisplayName(file)}>{fileDisplayName(file)}</strong>
                    <small title={file.filename_download}>{file.filename_download}</small>
                  </div>
                  <div className="file-meta-row">
                    <span>{fileTypeLabel(file)}</span>
                    <span>{formatBytes(file.filesize)}</span>
                  </div>
                  <div className="file-card-actions">
                    <button className="text-button" type="button" onClick={() => download(file)}>Download</button>
                    <button className="text-button" type="button" onClick={() => beginEdit(file)}>Edit</button>
                    <button className="danger-button" type="button" onClick={() => remove(file)}>Delete</button>
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
            itemLabel="files"
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </section>
      ) : (
        <section className="table-panel">
          <div className="table-scroll">
            <table>
              <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Storage</th><th>Uploaded</th><th /></tr></thead>
              <tbody>
                {pageFiles.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <div className="file-list-name">
                        <div className="file-list-thumb"><FilePreview file={file} label={fileTypeLabel(file)} /></div>
                        <span><strong>{fileDisplayName(file)}</strong><small>{file.filename_download}</small></span>
                      </div>
                    </td>
                    <td>{file.mimetype || fileTypeLabel(file)}</td>
                    <td>{formatBytes(file.filesize)}</td>
                    <td>{file.storage}</td>
                    <td>{file.uploaded_at ? new Date(file.uploaded_at).toLocaleString() : '—'}</td>
                    <td className="row-actions">
                      <button className="text-button" type="button" onClick={() => download(file)}>Download</button>
                      <button className="text-button" type="button" onClick={() => beginEdit(file)}>Edit</button>
                      <button className="danger-button" type="button" onClick={() => remove(file)}>Delete</button>
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
            itemLabel="files"
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </section>
      )}
    </div>
  );
}
