import { useEffect, useState } from 'react';

import { apiBlob } from '../api.js';

const IMAGE_EXTENSIONS = new Set([
  'avif', 'bmp', 'gif', 'heic', 'heif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp',
]);

function fileExtension(file) {
  const name = file?.filename_download || '';
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isPreviewableImage(file) {
  if (file?.mimetype?.toLowerCase().startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(fileExtension(file));
}

export function FilePreview({ file, label = 'File', alt = '' }) {
  const previewable = isPreviewableImage(file);
  const [state, setState] = useState({ status: previewable ? 'loading' : 'placeholder', url: '' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    if (!previewable) {
      setState({ status: 'placeholder', url: '' });
      return undefined;
    }

    setState({ status: 'loading', url: '' });
    apiBlob(`/files/${encodeURIComponent(file.id)}/content`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', url: '' });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, previewable]);

  if (state.status === 'ready') {
    return (
      <img
        src={state.url}
        alt={alt}
        loading="lazy"
        onError={() => {
          if (state.url) URL.revokeObjectURL(state.url);
          setState({ status: 'error', url: '' });
        }}
      />
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="file-preview-state" aria-label={`Loading preview for ${file.filename_download || 'file'}`}>
        <span className="file-preview-spinner" aria-hidden="true" />
        <small>Loading preview</small>
      </div>
    );
  }

  return (
    <div className={`file-type-placeholder ${state.status === 'error' ? 'preview-error' : ''}`} aria-hidden="true">
      <strong>{label}</strong>
      {state.status === 'error' && <small>Preview unavailable</small>}
    </div>
  );
}
