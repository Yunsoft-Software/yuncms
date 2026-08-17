import { useI18n } from '../i18n.js';
import { FilePreview } from './FilePreview.jsx';
import { Modal } from './Modal.jsx';

function fileLabel(file, fallback) {
  return file?.title || file?.filename_download || fallback;
}

export function FilePreviewModal({ file, onClose }) {
  const { t } = useI18n();
  if (!file) return null;

  return (
    <Modal
      open
      title={fileLabel(file, t('files.file'))}
      description={file.filename_download || file.mimetype || ''}
      eyebrow={t('files.preview')}
      className="file-preview-modal"
      onClose={onClose}
      actions={(
        <button className="primary-button" type="button" onClick={onClose}>
          {t('common.close')}
        </button>
      )}
    >
      <div className="file-preview-full">
        <FilePreview file={file} label={file.mimetype || t('files.file')} alt={fileLabel(file, '')} />
      </div>
      <div className="file-preview-details">
        <span><strong>{t('common.type')}</strong><small>{file.mimetype || '—'}</small></span>
        <span><strong>{t('files.storage')}</strong><small>{file.storage || '—'}</small></span>
      </div>
    </Modal>
  );
}
