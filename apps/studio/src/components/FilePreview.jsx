import { useEffect, useState } from 'react';

import { apiBlob } from '../api.js';
import { filePreviewKind } from '../file-preview-kind.js';
import { useI18n } from '../i18n.js';

export { isPreviewableImage } from '../file-preview-kind.js';

export function FilePreview({ file, label, alt = '' }) {
  const { t } = useI18n();
  const previewKind = filePreviewKind(file);
  const previewable = previewKind !== 'placeholder';
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
  }, [file.id, previewable, previewKind]);

  if (state.status === 'ready') {
    if (previewKind === 'pdf') {
      return (
        <iframe
          className="file-preview-pdf"
          src={state.url}
          title={alt || file.filename_download || t('files.pdf')}
          loading="lazy"
        />
      );
    }
    if (previewKind === 'video') {
      return (
        <video className="file-preview-video" src={state.url} controls preload="metadata">
          {t('files.previewUnavailable')}
        </video>
      );
    }
    if (previewKind === 'audio') {
      return (
        <div className="file-preview-audio-shell">
          <strong>{label || t('files.audio')}</strong>
          <audio className="file-preview-audio" src={state.url} controls preload="metadata">
            {t('files.previewUnavailable')}
          </audio>
        </div>
      );
    }
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
      <div className="file-preview-state" aria-label={t('files.loadingPreviewFor', { file: file.filename_download || t('files.file') })}>
        <span className="file-preview-spinner" aria-hidden="true" />
        <small>{t('files.loadingPreview')}</small>
      </div>
    );
  }

  return (
    <div className={`file-type-placeholder ${state.status === 'error' ? 'preview-error' : ''}`} aria-hidden="true">
      <strong>{label || t('files.file')}</strong>
      {state.status === 'error' && <small>{t('files.previewUnavailable')}</small>}
    </div>
  );
}
