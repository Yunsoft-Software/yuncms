export function UploadQueue({ items = [], labels = {}, onRemove }) {
  if (items.length === 0) return null;

  return (
    <div className="upload-queue" aria-label={labels.title || 'Upload queue'}>
      <div className="upload-queue-heading">
        <strong>{labels.title || 'Upload queue'}</strong>
        <span>{items.length}</span>
      </div>
      <div className="upload-queue-list">
        {items.map((item) => (
          <div className={`upload-queue-item status-${item.status || 'queued'}`} key={item.id}>
            <div className="upload-queue-copy">
              <strong title={item.file?.name}>{item.file?.name || labels.untitled || 'Untitled'}</strong>
              <small>{item.sizeLabel || ''}</small>
              {item.error && <small className="upload-queue-error" role="alert">{item.error}</small>}
            </div>
            <div className="upload-queue-state">
              <span className="upload-queue-status">
                {labels[item.status] || item.status || labels.queued || 'Queued'}
              </span>
              {onRemove && ['queued', 'failed'].includes(item.status) && (
                <button
                  className="text-button"
                  type="button"
                  aria-label={labels.remove || 'Remove'}
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
