import { useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import { fileAcceptForField, isImageField } from '../field-ui.js';
import { FilePreview, isPreviewableImage } from './FilePreview.jsx';

function displayName(file) {
  return file?.title || file?.filename_download || file?.id || '';
}

function filesForField(field, files) {
  if (!isImageField(field)) return files;
  return files.filter(isPreviewableImage);
}

export function FileFieldControl({ field, value, files, onChange, onFileUploaded, t }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const available = useMemo(() => filesForField(field, files), [field, files]);
  const selected = files.find((file) => String(file.id) === String(value)) ?? null;

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const response = await apiRequest('/files', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-filename': encodeURIComponent(file.name),
          'x-mimetype': file.type || 'application/octet-stream',
        },
        body: file,
      });
      const created = response?.data;
      if (!created?.id) throw new Error(t('fileField.uploadFailed'));
      onFileUploaded(created);
      onChange(created.id);
    } catch (requestError) {
      setError(requestError.message || t('fileField.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="file-field-control">
      <div className="file-field-picker-row">
        <select value={value ?? ''} onChange={(event) => onChange(event.target.value)} required={Boolean(field.required)}>
          <option value="">{field.required ? t('fileField.chooseFile') : t('common.none')}</option>
          {selected && !available.some((file) => String(file.id) === String(selected.id)) && (
            <option value={selected.id}>{displayName(selected)}</option>
          )}
          {available.map((file) => (
            <option key={file.id} value={file.id}>{displayName(file)}</option>
          ))}
        </select>
        <label className={`secondary-button file-field-upload ${uploading ? 'disabled' : ''}`}>
          <input
            type="file"
            accept={fileAcceptForField(field)}
            disabled={uploading}
            onChange={upload}
          />
          {uploading ? t('fileField.uploading') : t('fileField.uploadNew')}
        </label>
      </div>

      {selected && (
        <div className="file-field-preview-card">
          <div className="file-field-preview-media">
            <FilePreview file={selected} label={isImageField(field) ? t('fieldType.image') : t('fieldType.file')} alt={displayName(selected)} />
          </div>
          <div className="file-field-preview-copy">
            <strong>{displayName(selected)}</strong>
            <small>{selected.mimetype || t('fieldType.file')}</small>
            <button className="text-button" type="button" onClick={() => onChange('')} disabled={Boolean(field.required)}>
              {t('fileField.clear')}
            </button>
          </div>
        </div>
      )}
      {error && <small className="field-error" role="alert">{error}</small>}
    </div>
  );
}

export function FileValuePreview({ field, value, files, t }) {
  if (value == null || value === '') return <span>—</span>;
  const file = files.find((entry) => String(entry.id) === String(value));
  if (!file) return <code className="file-id-fallback">{String(value)}</code>;
  return (
    <div className="file-value-preview">
      <div className="file-value-thumb">
        <FilePreview file={file} label={isImageField(field) ? t('fieldType.image') : t('fieldType.file')} alt={displayName(file)} />
      </div>
      <span title={displayName(file)}>{displayName(file)}</span>
    </div>
  );
}
