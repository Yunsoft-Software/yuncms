import { useEffect, useState } from 'react';

import { apiRequest } from '../api.js';
import { useI18n } from '../i18n.js';
import { FilePickerModal } from './FilePickerModal.jsx';
import { FilePreview } from './FilePreview.jsx';

function fileLabel(file) {
  return file?.title || file?.filename_download || file?.id || '';
}

export function BrandAssetPicker({
  value = null,
  onChange,
  kind = 'logo',
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!value) {
      setSelected(null);
      return undefined;
    }
    let cancelled = false;
    apiRequest(`/files/${encodeURIComponent(value)}`)
      .then((response) => {
        if (!cancelled) setSelected(response?.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setSelected(null);
      });
    return () => { cancelled = true; };
  }, [value]);

  const title = t(kind === 'favicon' ? 'appearance.faviconFromFiles' : 'appearance.logoFromFiles');
  const hint = t(kind === 'favicon' ? 'appearance.faviconFromFilesHint' : 'appearance.logoFromFilesHint');

  return (
    <div className="brand-asset-picker">
      <div className="brand-asset-picker-heading">
        <div><strong>{title}</strong><p>{hint}</p></div>
      </div>

      <div className={`brand-asset-current ${selected ? 'has-file' : ''}`}>
        {selected ? (
          <>
            <span className="brand-asset-thumb"><FilePreview file={selected} alt="" /></span>
            <span className="brand-asset-copy"><strong>{fileLabel(selected)}</strong><small>{selected.mimetype}</small></span>
          </>
        ) : (
          <span className="brand-asset-default">
            <strong>{t('appearance.defaultAsset')}</strong>
            <small>{t(kind === 'favicon' ? 'appearance.defaultFaviconHint' : 'appearance.defaultLogoHint')}</small>
          </span>
        )}
        <div className="brand-asset-actions">
          <button className="secondary-button" type="button" onClick={() => setOpen(true)}>
            {t('appearance.selectFromFiles')}
          </button>
          {value && (
            <button className="text-button" type="button" onClick={() => onChange(null)}>
              {t('appearance.useDefaultAsset')}
            </button>
          )}
        </div>
      </div>

      <FilePickerModal
        open={open}
        value={value}
        imagesOnly
        title={title}
        description={hint}
        onClose={() => setOpen(false)}
        onSelect={(file) => {
          setSelected(file);
          onChange(file.id);
          setOpen(false);
        }}
      />
    </div>
  );
}
