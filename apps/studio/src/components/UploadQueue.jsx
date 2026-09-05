import { useI18n } from '../i18n.js';

export function UploadQueue({ items = [], labels = {}, onRemove }) {
  const { t } = useI18n();
  if (items.length === 0) return null;

  const title = labels.title || t('files.uploadQueue');
  const statusLabels = {
    queued: labels.queued || t('files.queueQueued'),
    uploading: labels.uploading || t('files.queueUploading'),
    done: labels.done || t('files.queueDone'),
    failed: labels.failed || t('files.queueFailed'),
  };

  return (
    <div className="upload-queue" aria-label={title}>
      <div className="upload-queue-heading">
        <strong>{title}</strong>
        <span>{items.length}</span>
      </div>
      <div className="upload-queue-list">
        {items.map((item) => (
          <div className={`upload-queue-item status-${item.status || 'queued'}`} key={item.id}>
            <div className="upload-queue-copy">
              <strong title={item.file?.name}>{item.file?.name || labels.untitled || t('files.untitled')}</strong>
              <small>{item.sizeLabel || ''}</small>
              {item.error && <small className="upload-queue-error" role="alert">{item.error}</small>}
            </div>
            <div className="upload-queue-state">
              <span className="upload-queue-status">
                {statusLabels[item.status] || item.status || statusLabels.queued}
              </span>
              {onRemove && ['queued', 'failed'].includes(item.status) && (
                <button
                  className="text-button"
                  type="button"
                  aria-label={labels.remove || t('files.queueRemove')}
                  onClick={() => onRemove(item.id)}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
