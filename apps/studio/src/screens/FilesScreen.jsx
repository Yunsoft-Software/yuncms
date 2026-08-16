import { useEffect, useState } from 'react';

import { apiBlob, apiRequest } from '../api.js';

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function FilesScreen() {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
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

  async function upload(event) {
    event.preventDefault();
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
      event.currentTarget.reset();
      setNotice('File uploaded');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'File could not be uploaded');
    } finally {
      setUploading(false);
    }
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
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message || 'File could not be downloaded');
    }
  }

  async function edit(file) {
    const filenameDownload = window.prompt('Download filename', file.filename_download);
    if (!filenameDownload) return;
    const title = window.prompt('Title (optional)', file.title || '');
    if (title == null) return;

    setError('');
    setNotice('');
    try {
      await apiRequest(`/files/${encodeURIComponent(file.id)}`, {
        method: 'PATCH',
        body: { filenameDownload, title: title || null },
      });
      setNotice('File metadata updated');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'File metadata could not be updated');
    }
  }

  async function remove(file) {
    if (!window.confirm(`Delete ${file.filename_download}?`)) return;
    setError('');
    setNotice('');
    try {
      await apiRequest(`/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
      setNotice('File deleted');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'File could not be deleted');
    }
  }

  return (
    <div className="screen-stack">
      <section className="panel form-panel">
        <div>
          <p className="eyebrow">Files</p>
          <h2>Local storage</h2>
          <p>Uploads are stored under the configured local storage root with UUID physical keys.</p>
        </div>
        <form className="toolbar-actions" onSubmit={upload}>
          <input
            type="file"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            required
          />
          <button className="primary-button" type="submit" disabled={!selectedFile || uploading}>
            {uploading ? 'Uploading…' : 'Upload file'}
          </button>
        </form>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      <section className="table-panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Storage</th><th>Uploaded</th><th /></tr></thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id}>
                  <td><strong>{file.title || file.filename_download}</strong><br /><small>{file.filename_download}</small></td>
                  <td>{file.mimetype || '—'}</td>
                  <td>{formatBytes(file.filesize)}</td>
                  <td>{file.storage}</td>
                  <td>{file.uploaded_at ? new Date(file.uploaded_at).toLocaleString() : '—'}</td>
                  <td className="row-actions">
                    <button className="text-button" type="button" onClick={() => download(file)}>Download</button>
                    <button className="text-button" type="button" onClick={() => edit(file)}>Edit</button>
                    <button className="danger-button" type="button" onClick={() => remove(file)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <div className="table-footer">Loading files…</div>}
        {!loading && files.length === 0 && <div className="table-footer">No files uploaded.</div>}
      </section>
    </div>
  );
}
