import {
  FIELD_TYPE_GROUPS,
  supportsAutoUpdate,
  supportsCurrentTimeDefault,
  supportsValueDefault,
} from '../field-ui.js';
import { useI18n } from '../i18n.js';

function TypeCard({ option, active, onSelect, t }) {
  return (
    <button
      className={`field-type-card ${active ? 'active' : ''}`}
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(option.value)}
    >
      <span className="field-type-card-icon" aria-hidden="true">{option.icon}</span>
      <span className="field-type-card-copy">
        <strong>{t(option.labelKey)}</strong>
        <small>{t(option.descriptionKey)}</small>
      </span>
      <span className="field-type-card-check" aria-hidden="true">{active ? '✓' : ''}</span>
    </button>
  );
}

export function FieldBuilder({ form, setForm, onSubmit, onCancel }) {
  const { t } = useI18n();
  const isMedia = form.type === 'file' || form.type === 'image';
  const canValueDefault = !isMedia && supportsValueDefault(form.type);
  const canNow = !isMedia && supportsCurrentTimeDefault(form.type);
  const canAutoUpdate = !isMedia && supportsAutoUpdate(form.type);

  function selectType(type) {
    setForm((current) => ({
      ...current,
      type,
      defaultMode: 'none',
      defaultValue: '',
      autoUpdate: false,
    }));
  }

  return (
    <form className="field-builder" onSubmit={onSubmit}>
      <div className="field-builder-header">
        <div>
          <p className="eyebrow">{t('dataModel.fields')}</p>
          <h3>{t('fieldBuilder.title')}</h3>
          <p>{t('fieldBuilder.description')}</p>
        </div>
        <button className="text-button" type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>

      <div className="field-builder-layout">
        <section className="field-type-browser" aria-label={t('fieldBuilder.chooseType')}>
          {FIELD_TYPE_GROUPS.map((group) => (
            <div className="field-type-group" key={group.key}>
              <div className="field-type-group-title">
                <strong>{t(group.labelKey)}</strong>
              </div>
              <div className="field-type-grid">
                {group.options.map((option) => (
                  <TypeCard
                    key={option.value}
                    option={option}
                    active={form.type === option.value}
                    onSelect={selectType}
                    t={t}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="field-config-panel">
          <div className="field-config-heading">
            <span className="field-config-type">{t(`fieldType.${form.type}`)}</span>
            <h4>{t('fieldBuilder.configureField')}</h4>
            <p>{t('fieldBuilder.configureHint')}</p>
          </div>

          <label className="field-label field-key-input">
            <span>{t('dataModel.fieldName')}</span>
            <input
              value={form.field}
              onChange={(event) => setForm((current) => ({ ...current, field: event.target.value }))}
              placeholder={isMedia ? (form.type === 'image' ? 'cover_image' : 'attachment') : 'title'}
              required
              autoFocus
            />
            <small>{t('fieldBuilder.keyHint')}</small>
          </label>

          {form.type === 'string' && (
            <label className="field-label">
              <span>{t('dataModel.maxLength')}</span>
              <input
                type="number"
                min="1"
                max="4096"
                value={form.length}
                onChange={(event) => setForm((current) => ({ ...current, length: event.target.value }))}
              />
            </label>
          )}

          {form.type === 'decimal' && (
            <div className="field-builder-number-grid">
              <label className="field-label">
                <span>{t('fieldBuilder.precision')}</span>
                <input type="number" min="1" max="65" value={form.precision} onChange={(event) => setForm((current) => ({ ...current, precision: event.target.value }))} />
              </label>
              <label className="field-label">
                <span>{t('fieldBuilder.scale')}</span>
                <input type="number" min="0" max="30" value={form.scale} onChange={(event) => setForm((current) => ({ ...current, scale: event.target.value }))} />
              </label>
            </div>
          )}

          <div className="field-builder-switches">
            <label className="field-option-card">
              <input
                type="checkbox"
                checked={form.required}
                onChange={(event) => setForm((current) => ({ ...current, required: event.target.checked }))}
              />
              <span><strong>{t('fieldBuilder.required')}</strong><small>{t('fieldBuilder.requiredHint')}</small></span>
            </label>
          </div>

          {(canValueDefault || canNow) && (
            <div className="field-default-panel">
              <div><strong>{t('fieldBuilder.defaultValue')}</strong><p>{t('fieldBuilder.defaultHint')}</p></div>
              <div className="segmented-control field-default-mode">
                <button className={form.defaultMode === 'none' ? 'active' : ''} type="button" onClick={() => setForm((current) => ({ ...current, defaultMode: 'none', defaultValue: '' }))}>{t('fieldBuilder.noDefault')}</button>
                {canValueDefault && <button className={form.defaultMode === 'value' ? 'active' : ''} type="button" onClick={() => setForm((current) => ({ ...current, defaultMode: 'value' }))}>{t('fieldBuilder.fixedValue')}</button>}
                {canNow && <button className={form.defaultMode === 'now' ? 'active' : ''} type="button" onClick={() => setForm((current) => ({ ...current, defaultMode: 'now', defaultValue: '' }))}>{t('fieldBuilder.currentTime')}</button>}
              </div>

              {form.defaultMode === 'value' && form.type === 'boolean' ? (
                <select value={String(form.defaultValue || 'false')} onChange={(event) => setForm((current) => ({ ...current, defaultValue: event.target.value }))}>
                  <option value="false">{t('common.no')}</option>
                  <option value="true">{t('common.yes')}</option>
                </select>
              ) : form.defaultMode === 'value' ? (
                <input
                  type={['integer', 'bigint', 'decimal'].includes(form.type) ? 'number' : form.type === 'date' ? 'date' : ['datetime', 'timestamp'].includes(form.type) ? 'datetime-local' : 'text'}
                  step={form.type === 'decimal' ? 'any' : undefined}
                  value={form.defaultValue}
                  onChange={(event) => setForm((current) => ({ ...current, defaultValue: event.target.value }))}
                  placeholder={t('fieldBuilder.defaultPlaceholder')}
                  required
                />
              ) : null}
            </div>
          )}

          {canAutoUpdate && (
            <label className="field-option-card timestamp-update-option">
              <input
                type="checkbox"
                checked={form.autoUpdate}
                onChange={(event) => setForm((current) => ({ ...current, autoUpdate: event.target.checked }))}
              />
              <span><strong>{t('fieldBuilder.autoUpdate')}</strong><small>{t('fieldBuilder.autoUpdateHint')}</small></span>
            </label>
          )}

          {isMedia && (
            <div className="inline-info field-interface-info">
              {t(form.type === 'image' ? 'dataModel.imageFieldInfo' : 'dataModel.fileFieldInfo')}
            </div>
          )}

          <div className="field-builder-actions">
            <button className="secondary-button" type="button" onClick={onCancel}>{t('common.cancel')}</button>
            <button className="primary-button" type="submit">{t('fieldBuilder.createField')}</button>
          </div>
        </section>
      </div>
    </form>
  );
}
