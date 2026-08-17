import { useEffect, useMemo, useState } from 'react';

import { apiBlob, apiRequest } from '../api.js';
import { useConfirmDialog } from '../components/DialogProvider.jsx';

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

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileTypeLabel(file) {
  const mimetype = file.mimetype || 'application/octet-stream';
  if (mimetype.startsWith('image/')) return 'Image';
  if (mimetype.startsWith('video/')) return 'Video';
  if (mimetype.startsWith('audio/')) return 'Audio';
  if (mimetype === 'application/pdf') return 'PDF';
  const extension = file.filename_download?.split('.').pop();
  return extension ? extension.toUpperCase() : 'File';
}

function fileCategory(file) {
  const mimetype = file.mimetype || '';
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype === 'application/pdf') return 'pdf';
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
  const leftName = fileDisplayName(left).toLocaleLowerCase();
  const rightName = fileDisplayName(right).toLocaleLowerCase();
  const result = leftName.localeCompare(rightName);
  return sort === 'name-desc' ? -result : result;
}

export function FilesScreen() {
  const requestConfirmation = useConfirmDialog();
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrls, setPreviewUrls] = useState({});
  const [view, setView] = useState('grid');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sort, setSort] = useState('newest');
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

  useEffect(() => {
    let cancelled = false;
    const createdUrls = [];

    async function loadPreviews() {
      const imageFiles = files.filter((file) =>
        file.mimetype?.startsWith('image/') && Number(file.filesize || 0) <= 12 * 1024 * 1024);

      const entries = await Promise.all(imageFiles.map(async (file) => {
        try {
          const blob = await apiBlob(`/files/${encodeURIComponent(file.id)}/content`);
          if (cancelled) return null;
          const url = URL.createObjectURL(blob);
          createdUrls.push(url);
          return [file.id, url];
        } catch {
          return null;
        }
      }));

      if (!cancelled) setPreviewUrls(Object.fromEntries(entries.filter(Boolean)));
    }

    setPreviewUrls({});
    loadPreviews();

    return () => {
      cancelled = true;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

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

  const hasActiveFilters = Boolean(search.trim() || typeFilter !== 'all' || sort !== 'newest');

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
  }

  return (
    <div className="screen-stack">
      <form className="panel file-upload-panel" onSubmit={upload}>
        <div>
          <p className="eyebrow">Library</p>
          <h2>Upload files</h2>
          <p>Drop a file here or choose one from your device.</p>
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

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      {editingFile && (
        <form className="panel form-panel file-editor" onSubmit={saveEdit}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">File details</p>
              <h2>{fileDisplayName(editingFile)}</h2>
              <p>Edit the human-facing title and download filename without changing the physical storage key.</p>
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

      <section className="panel library-toolbar workspace-toolbar">
        <div className="workspace-toolbar-heading">
          <div>
            <p className="eyebrow">Files</p>
            <h2>{visibleFiles.length === files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'}` : `${visibleFiles.length} of ${files.length} files`}</h2>
            <p>Search the library, narrow by type and keep the same view while sorting.</p>
          </div>
          <div className="segmented-control" aria-label="File view">
            <button className={view === 'grid' ? 'active' : ''} type="button" onClick={() => setView('grid')}>Gallery</button>
            <button className={view === 'list' ? 'active' : ''} type="button" onClick={() => setView('list')}>List</button>
          </div>
        </div>

        <div className="list-controls">
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
            <span className="result-count">{visibleFiles.length} visible</span>
            {hasActiveFilters && <button className="text-button" type="button" onClick={resetControls}>Reset</button>}
          </div>
        </div>
      </section>

      {loading ? (
        <section className="panel"><p>Loading files…</p></section>
      ) : visibleFiles.length === 0 ? (
        <section className="panel empty-state empty-state-action">
          <div>
            <h2>{files.length === 0 ? 'No files yet' : 'No matching files'}</h2>
            <p>{files.length === 0 ? 'Upload the first file to start building your library.' : 'Try a broader search or reset the filters.'}</p>
          </div>
          {files.length > 0 && <button className="text-button" type="button" onClick={resetControls}>Reset filters</button>}
        </section>
      ) : view === 'grid' ? (
        <section className="file-grid" aria-label="File gallery">
          {visibleFiles.map((file) => (
            <article className="file-card" key={file.id}>
              <div className="file-preview">
                {previewUrls[file.id] ? (
                  <img src={previewUrls[file.id]} alt="" />
                ) : (
                  <div className="file-type-placeholder" aria-hidden="true">{fileTypeLabel(file)}</div>
                )}
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
        </section>
      ) : (
        <section className="table-panel">
          <div className="table-scroll">
            <table>
              <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Storage</th><th>Uploaded</th><th /></tr></thead>
              <tbody>
                {visibleFiles.map((file) => (
                  <tr key={file.id}>
                    <td><strong>{fileDisplayName(file)}</strong><br /><small>{file.filename_download}</small></td>
                    <td>{file.mimetype || '—'}</td>
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
          <div className="table-footer">Showing {visibleFiles.length} of {files.length} files</div>
        </section>
      )}
    </div>
  );
}
