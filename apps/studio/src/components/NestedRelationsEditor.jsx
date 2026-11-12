import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { inputValueForField } from '../content-field-values.js';
import { relationPreview } from '../content-presentation.js';
import { tabRevealDelta, tabTargetIndex } from '../tab-navigation.js';

import { slugifyText } from '../content-relations.js';
import {
  isFileField,
  isRichTextField,
  isSelectDropdownField,
  selectChoicesForField,
} from '../field-ui.js';
import { useI18n } from '../i18n.js';
import { displaySchemaName } from '../schema-name.js';
import { BooleanFieldControl } from './BooleanFieldControl.jsx';
import { FileFieldControl, FileValuePreview } from './FileFieldControl.jsx';
import { RelationPicker } from './RelationPicker.jsx';
import { RichTextEditor } from './RichTextEditor.jsx';

function fieldLabel(field) {
  return displaySchemaName(field, 'field');
}

function fieldInputType(field) {
  if (['integer', 'bigint', 'decimal'].includes(field?.type)) return 'number';
  if (field?.type === 'date') return 'date';
  if (['datetime', 'timestamp'].includes(field?.type)) return 'datetime-local';
  return 'text';
}

function shortLanguageBadge(code = '') {
  const parts = String(code || '').split('-');
  return (parts[0] || code || '?').toUpperCase();
}

function hasFilledTranslation(values = {}) {
  return Object.values(values).some((val) => {
    if (val == null) return false;
    if (typeof val === 'boolean') return val === true;
    return String(val).trim() !== '';
  });
}

function renderControlForField({
  field,
  value,
  allValues,
  relationLookups = {},
  files = [],
  onFileUploaded,
  onChange,
  onGenerateSlug,
  disabled = false,
  required = false,
  t,
}) {
  const relationLookup = relationLookups[field.field];
  const label = fieldLabel(field);
  const isRich = isRichTextField(field);
  const isDropdown = isSelectDropdownField(field);
  const choices = isDropdown ? selectChoicesForField(field) : [];
  const isSlugOrUrl = (field.field === 'slug' || field.field === 'url') && ('title' in (allValues || {}) || 'name' in (allValues || {}));
  const FieldTag = isRich ? 'div' : 'label';

  return (
    <FieldTag
      className={`field-label ${isFileField(field) ? 'file-field-label' : ''} ${isRich ? 'richtext-field-label' : ''}`}
      data-field={field.field}
      key={field.field}
    >
      <span className="nested-field-label-row">
        <span>{label}{field.required ? ' *' : ''}</span>
        {isSlugOrUrl && !disabled && (
          <button
            type="button"
            className="text-button slug-generate-btn"
            data-testid={`generate-slug-${field.field}`}
            onClick={onGenerateSlug}
          >
            ✨ {t('relations.generateSlug')}
          </button>
        )}
      </span>
      {label !== field.field && <small className="field-api-key">{field.field}</small>}

      {isFileField(field) ? (
        <FileFieldControl
          field={{ ...field, required }}
          value={value ?? ''}
          files={files}
          t={t}
          onFileUploaded={onFileUploaded}
          onChange={onChange}
        />
      ) : relationLookup ? (
        <RelationPicker
          value={value ?? ''}
          items={relationLookup.items}
          keyField={relationLookup.keyField}
          labelField={relationLookup.labelField}
          required={required}
          disabled={disabled}
          placeholder={required ? t('content.select') : t('common.none')}
          searchPlaceholder={t('content.relationSearch')}
          emptyLabel={t('content.relationEmpty')}
          noneLabel={t('common.none')}
          onChange={onChange}
        />
      ) : isRich ? (
        <RichTextEditor
          value={value ?? ''}
          files={files}
          onFileUploaded={onFileUploaded}
          required={required}
          disabled={disabled}
          onChange={onChange}
        />
      ) : isDropdown && choices.length > 0 ? (
        <select
          value={value ?? ''}
          disabled={disabled}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{required ? t('content.select') : t('common.none')}</option>
          {value && !choices.some((choice) => String(choice.value) === String(value)) && (
            <option value={value}>{String(value)}</option>
          )}
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      ) : field.type === 'boolean' ? (
        <BooleanFieldControl label={label} value={value} disabled={disabled} onChange={onChange} />
      ) : field.type === 'text' || field.type === 'json' ? (
        <textarea
          rows={field.type === 'json' ? 6 : 4}
          value={value ?? ''}
          disabled={disabled}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          type={fieldInputType(field)}
          step={field.type === 'decimal' ? 'any' : undefined}
          value={value ?? ''}
          disabled={disabled}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FieldTag>
  );
}

function TranslationsSection({
  relation,
  draft = {},
  onChangeDraft,
  files = [],
  onFileUploaded,
  disabled = false,
  compact = false,
}) {
  const { t } = useI18n();
  const languages = relation.languages ?? [];
  const [activeLang, setActiveLang] = useState(() => languages[0]?.code || 'tr-TR');
  const [viewMode, setViewMode] = useState('tabs');
  const selectedLang = languages.some(language => language.code === activeLang) ? activeLang : languages[0]?.code;
  const languageKeys = languages.map(language => language.code).join('|');
  const tabStatuses = languages.map((language) => {
    const entry = draft[language.code];
    return !entry?.cleared && hasFilledTranslation(entry?.values) ? '1' : '0';
  }).join('');
  const tabsRef = useRef(null);

  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return undefined;
    const revealSelected = () => {
      const selected = tabs.querySelector('[aria-selected="true"]');
      if (!selected) return;
      const bounds = tabs.getBoundingClientRect(), target = selected.getBoundingClientRect();
      const inset = Number.parseFloat(getComputedStyle(tabs).paddingInlineStart) || 0;
      const left = tabRevealDelta(bounds, target, inset);
      if (left) tabs.scrollBy({ left, behavior: 'instant' });
    };
    const observer = new ResizeObserver(revealSelected);
    observer.observe(tabs);
    for (const tab of tabs.querySelectorAll('[role="tab"]')) observer.observe(tab);
    revealSelected();
    return () => observer.disconnect();
  }, [selectedLang, languageKeys, tabStatuses, viewMode]);

  const visibleLanguages = viewMode === 'split' && !compact
    ? languages
    : languages.filter((lang) => lang.code === selectedLang);
  const effectiveLanguages = visibleLanguages.length > 0 ? visibleLanguages : languages.slice(0, 1);

  function updateField(langCode, fieldName, nextValue) {
    const currentEntry = draft[langCode] ?? { id: null, languageCode: langCode, cleared: false, values: {} };
    onChangeDraft({
      ...draft,
      [langCode]: {
        ...currentEntry,
        cleared: false,
        values: {
          ...currentEntry.values,
          [fieldName]: nextValue,
        },
      },
    });
  }

  function clearLanguage(langCode) {
    const currentEntry = draft[langCode];
    if (!currentEntry) return;
    const emptyValues = Object.fromEntries(
      relation.editableFields.map((f) => [f.field, f.type === 'boolean' ? false : '']),
    );
    onChangeDraft({
      ...draft,
      [langCode]: {
        ...currentEntry,
        cleared: true,
        values: emptyValues,
      },
    });
  }

  function generateSlugForLanguage(langCode, fieldName) {
    const currentEntry = draft[langCode];
    const sourceText = currentEntry?.values?.title || currentEntry?.values?.name || '';
    if (!sourceText) return;
    const preserveLeadingSlash = fieldName === 'url' || String(currentEntry?.values?.[fieldName] || '').startsWith('/');
    const generated = slugifyText(sourceText, { preserveLeadingSlash: false });
    if (!generated) return;
    updateField(langCode, fieldName, fieldName === 'url' ? `/${generated}` : generated);
  }

  return (
    <section className="nested-relation-panel nested-translations-panel" data-testid={`nested-translations-${relation.childCollection}`}>
      <div className="nested-relation-header">
        <div>
          <p className="eyebrow">{relation.childCollection}</p>
          <h3>{t('relations.translationsTitle')}</h3>
          <p>{t('relations.translationsDescription')}</p>
        </div>
        {!compact && languages.length > 1 && (
          <div className="segmented-control nested-view-mode-switch">
            <button
              type="button"
              className={viewMode === 'tabs' ? 'active' : ''}
              onClick={() => setViewMode('tabs')}
            >
              {t('relations.tabView')}
            </button>
            <button
              type="button"
              className={viewMode === 'split' ? 'active' : ''}
              onClick={() => setViewMode('split')}
            >
              {t('relations.splitView')}
            </button>
          </div>
        )}
      </div>

      {viewMode === 'tabs' && (
        <div ref={tabsRef} className="nested-language-tabs" role="tablist" aria-label={t('relations.translationsTitle')}>
          {languages.map((lang, index) => {
            const entry = draft[lang.code];
            const filled = !entry?.cleared && hasFilledTranslation(entry?.values);
            const isActive = lang.code === selectedLang;
            return (
              <button
                key={lang.code}
                type="button"
                role="tab"
                id={`${relation.key}-${lang.code}-tab`}
                aria-selected={isActive}
                aria-controls={`${relation.key}-${lang.code}-panel`}
                tabIndex={isActive ? 0 : -1}
                className={`nested-language-tab ${isActive ? 'active' : ''} ${filled ? 'is-filled' : 'is-empty'}`}
                onClick={() => setActiveLang(lang.code)}
                onKeyDown={(event) => {
                  if (event.altKey || event.ctrlKey || event.metaKey) return;
                  const target = tabTargetIndex(event.key, index, languages.length);
                  if (target === null) return;
                  event.preventDefault();
                  setActiveLang(languages[target].code);
                  event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[target]?.focus({ preventScroll: true });
                }}
              >
                <span className="nested-lang-code">{shortLanguageBadge(lang.code)}</span>
                <span className="nested-lang-name">{lang.name || lang.code}</span>
                <small className={`nested-lang-status ${filled ? 'filled' : 'empty'}`}>
                  {filled ? `● ${t('relations.filled')}` : `○ ${t('relations.empty')}`}
                </small>
              </button>
            );
          })}
        </div>
      )}

      <div className={`nested-languages-grid ${viewMode === 'split' && !compact ? 'is-split' : ''}`}>
        {effectiveLanguages.map((lang) => {
          const entry = draft[lang.code] ?? { id: null, languageCode: lang.code, cleared: false, values: {} };
          const filled = !entry.cleared && hasFilledTranslation(entry.values);
          return (
            <div className="nested-language-card" key={lang.code} id={`${relation.key}-${lang.code}-panel`} data-lang={lang.code} dir={lang.direction === 'rtl' ? 'rtl' : undefined} role={viewMode === 'tabs' ? 'tabpanel' : undefined} aria-labelledby={viewMode === 'tabs' ? `${relation.key}-${lang.code}-tab` : undefined}>
              <div className="nested-language-card-header">
                <div>
                  <span className="nested-lang-code">{shortLanguageBadge(lang.code)}</span>
                  <strong>{lang.name || lang.code}</strong>
                  <code>{lang.code}</code>
                </div>
                {filled && !disabled && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => clearLanguage(lang.code)}
                  >
                    {t('relations.clearTranslation', { language: lang.name || lang.code })}
                  </button>
                )}
              </div>

              <div className="form-grid record-form-grid nested-fields-grid">
                {relation.editableFields.map((field) => renderControlForField({
                  field,
                  value: entry.values?.[field.field] ?? '',
                  allValues: entry.values ?? {},
                  relationLookups: relation.relationLookups,
                  files,
                  onFileUploaded,
                  disabled,
                  required: false,
                  t,
                  onChange: (nextVal) => updateField(lang.code, field.field, nextVal),
                  onGenerateSlug: () => generateSlugForLanguage(lang.code, field.field),
                }))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function M2MSection({
  relation,
  selectedIds = [],
  onChangeSelectedIds,
  disabled = false,
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const items = relation.lookup?.items ?? [];
  const keyField = relation.lookup?.keyField || 'id';
  const labelField = relation.lookup?.labelField || keyField;
  const selectedSet = useMemo(() => new Set((selectedIds ?? []).map(String)), [selectedIds]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const key = item?.[keyField];
      const label = item?.[labelField];
      return [key, label].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [items, keyField, labelField, query]);

  function toggleItem(itemId) {
    if (disabled) return;
    const strId = String(itemId);
    const next = new Set(selectedSet);
    if (next.has(strId)) next.delete(strId);
    else next.add(strId);
    onChangeSelectedIds([...next]);
  }

  return (
    <section className="nested-relation-panel nested-m2m-panel" data-testid={`nested-m2m-${relation.junctionCollection}`}>
      <div className="nested-relation-header">
        <div>
          <p className="eyebrow">{relation.targetCollection}</p>
          <h3>{t('relations.m2mTitle', { collection: relation.alias })}</h3>
          <p>{t('relations.m2mDescription', { collection: relation.targetCollection })}</p>
        </div>
        <span className="nested-count-badge">
          {t('relations.selectedCount', { count: selectedSet.size })}
        </span>
      </div>

      {items.length > 5 && (
        <div className="nested-m2m-search">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('content.relationSearch')}
          />
        </div>
      )}

      <div className="nested-m2m-grid" role="group" aria-label={relation.alias}>
        {filteredItems.map((item) => {
          const itemId = String(item?.[keyField]);
          const itemLabel = item?.[labelField] ?? itemId;
          const active = selectedSet.has(itemId);
          return (
            <button
              key={itemId}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              className={`nested-m2m-option ${active ? 'active' : ''}`}
              onClick={() => toggleItem(itemId)}
            >
              <span className="nested-m2m-check" aria-hidden="true">{active ? '✓' : '+'}</span>
              <span className="nested-m2m-label" title={String(itemLabel)}>{String(itemLabel)}</span>
            </button>
          );
        })}
        {filteredItems.length === 0 && (
          <p className="muted-line">{t('content.relationEmpty')}</p>
        )}
      </div>
    </section>
  );
}

function O2MSection({
  relation,
  items = [],
  onChangeItems,
  files = [],
  onFileUploaded,
  disabled = false,
}) {
  const { t } = useI18n();
  const visibleItems = items.filter((item) => !item.deleted);

  function addItem() {
    if (disabled) return;
    const defaultValues = Object.fromEntries(
      relation.editableFields.map((field) => [field.field, inputValueForField(field, undefined)]),
    );
    onChangeItems([
      ...items,
      {
        _localId: `new-${Date.now()}-${items.length}`,
        id: null,
        deleted: false,
        values: defaultValues,
      },
    ]);
  }

  function updateItemField(localId, fieldName, nextValue) {
    onChangeItems(
      items.map((item) => (
        item._localId === localId
          ? { ...item, values: { ...item.values, [fieldName]: nextValue } }
          : item
      )),
    );
  }

  function removeItem(localId) {
    onChangeItems(
      items
        .map((item) => (item._localId === localId ? { ...item, deleted: true } : item))
        .filter((item) => !(item.deleted && item.id == null)),
    );
  }

  return (
    <section className="nested-relation-panel nested-o2m-panel" data-testid={`nested-o2m-${relation.childCollection}`}>
      <div className="nested-relation-header">
        <div>
          <p className="eyebrow">{relation.childCollection}</p>
          <h3>{t('relations.o2mTitle', { collection: relation.alias })}</h3>
          <p>{t('relations.o2mDescription', { collection: relation.childCollection })}</p>
        </div>
        {!disabled && (
          <button type="button" className="secondary-button" onClick={addItem}>
            + {t('relations.addLinkedItem', { collection: relation.alias })}
          </button>
        )}
      </div>

      {visibleItems.length === 0 ? (
        <p className="muted-line">{t('relations.noLinkedItems')}</p>
      ) : (
        <div className="nested-o2m-list">
          {visibleItems.map((item, index) => (
            <div className="nested-o2m-card" key={item._localId}>
              <div className="nested-o2m-card-header">
                <strong>#{index + 1} {item.id ? `(${item.id})` : ''}</strong>
                {!disabled && (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => removeItem(item._localId)}
                  >
                    {t('relations.removeLinkedItem')}
                  </button>
                )}
              </div>
              <div className="form-grid record-form-grid nested-fields-grid">
                {relation.editableFields.map((field) => renderControlForField({
                  field,
                  value: item.values?.[field.field] ?? '',
                  allValues: item.values ?? {},
                  relationLookups: relation.relationLookups,
                  files,
                  onFileUploaded,
                  disabled,
                  required: false,
                  t,
                  onChange: (nextVal) => updateItemField(item._localId, field.field, nextVal),
                }))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function NestedRelationsEditor({
  nestedRelations = [],
  draftState = {},
  setDraftState,
  files = [],
  onFileUploaded,
  disabled = false,
  compact = false,
}) {
  if (!nestedRelations.length) return null;

  function updateRelationDraft(key, nextRelDraft) {
    setDraftState((current) => ({
      ...current,
      [key]: nextRelDraft,
    }));
  }

  return (
    <div className="nested-relations-stack">
      {nestedRelations.map((relation) => {
        if (relation.kind === 'translations') {
          return (
            <TranslationsSection
              key={relation.key}
              relation={relation}
              draft={draftState[relation.key] ?? {}}
              onChangeDraft={(next) => updateRelationDraft(relation.key, next)}
              files={files}
              onFileUploaded={onFileUploaded}
              disabled={disabled}
              compact={compact}
            />
          );
        }
        if (relation.kind === 'm2m') {
          return (
            <M2MSection
              key={relation.key}
              relation={relation}
              selectedIds={draftState[relation.key] ?? []}
              onChangeSelectedIds={(next) => updateRelationDraft(relation.key, next)}
              disabled={disabled}
            />
          );
        }
        if (relation.kind === 'o2m') {
          return (
            <O2MSection
              key={relation.key}
              relation={relation}
              items={draftState[relation.key] ?? []}
              onChangeItems={(next) => updateRelationDraft(relation.key, next)}
              files={files}
              onFileUploaded={onFileUploaded}
              disabled={disabled}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

export function NestedRelationCell({ relation, rows = [], files = [], t }) {
  if (!relation) return <span className="content-value-empty">—</span>;

  if (relation.kind === 'translations') {
    if (!rows.length) {
      return <span className="content-value-empty">{t('relations.noTranslations')}</span>;
    }
    const sorted = [...rows].sort((a, b) => {
      const ca = String(a[relation.languageField] || '').toLowerCase();
      const cb = String(b[relation.languageField] || '').toLowerCase();
      if (ca.startsWith('tr') && !cb.startsWith('tr')) return -1;
      if (!ca.startsWith('tr') && cb.startsWith('tr')) return 1;
      return ca.localeCompare(cb);
    });
    const imageField = (relation.editableFields ?? []).find((f) => isFileField(f));
    const firstWithImage = imageField ? sorted.find((r) => r[imageField.field]) : null;
    const preview = relationPreview(sorted);

    return (
      <div className="nested-cell-translations">
        {firstWithImage && imageField && (
          <div className="nested-cell-thumb">
            <FileValuePreview field={imageField} value={firstWithImage[imageField.field]} files={files} t={t} />
          </div>
        )}
        <div className="nested-cell-translation-list">
          {preview.visible.map((row) => {
            const langCode = row[relation.languageField] || '';
            const primaryText = row.title || row.name || row.url || row.slug || `#${row.id}`;
            const secondaryText = row.slug || (row.url && row.url !== primaryText ? row.url : '');
            return (
              <div className="nested-cell-translation-row" key={`${langCode}-${row.id}`}>
                <span className="nested-lang-badge">{shortLanguageBadge(langCode)}</span>
                <strong className="nested-translation-title" title={String(primaryText)}>
                  {String(primaryText)}
                </strong>
                {secondaryText && (
                  <code className="nested-translation-slug" title={String(secondaryText)}>{String(secondaryText)}</code>
                )}
              </div>
            );
          })}
          {preview.remaining > 0 && <span className="nested-count-badge" title={t('relations.linkedCount', { count: rows.length })}>+{preview.remaining}</span>}
        </div>
      </div>
    );
  }

  if (relation.kind === 'm2m') {
    if (!rows.length) return <span className="content-value-empty">—</span>;
    const items = relation.lookup?.items ?? [];
    const keyField = relation.lookup?.keyField || 'id';
    const labelField = relation.lookup?.labelField || keyField;
    const preview = relationPreview(rows);
    return (
      <div className="nested-cell-chips">
        {preview.visible.map((row) => {
          const targetId = row[relation.targetJunctionField];
          const matched = items.find((entry) => String(entry?.[keyField]) === String(targetId));
          const label = matched?.[labelField] ?? targetId;
          return (
            <span className="nested-m2m-chip" title={String(label)} key={String(row.id ?? targetId)}>
              <span className="nested-chip-label">{String(label)}</span>
            </span>
          );
        })}
        {preview.remaining > 0 && <span className="nested-count-badge" title={t('relations.linkedCount', { count: rows.length })}>+{preview.remaining}</span>}
      </div>
    );
  }

  if (relation.kind === 'o2m') {
    if (!rows.length) return <span className="content-value-empty">—</span>;
    const fileField = (relation.editableFields ?? []).find((f) => isFileField(f));
    if (fileField) {
      return (
        <div className="nested-cell-files">
          {rows.slice(0, 2).map((row) => (
            <FileValuePreview
              key={String(row.id)}
              field={fileField}
              value={row[fileField.field]}
              files={files}
              t={t}
            />
          ))}
          {rows.length > 2 && (
            <span className="nested-count-badge">+{rows.length - 2}</span>
          )}
        </div>
      );
    }
    return (
      <span className="nested-count-badge">
        {t('relations.linkedCount', { count: rows.length })}
      </span>
    );
  }

  return <span className="content-value-empty">—</span>;
}
