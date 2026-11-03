import { useEffect, useMemo, useRef, useState } from 'react';

import { API_URL } from '../api.js';
import { useI18n } from '../i18n.js';

function stripTagsToText(html = '') {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countStats(html = '') {
  const plain = stripTagsToText(html);
  const words = plain ? plain.split(/\s+/).filter(Boolean).length : 0;
  return { words, chars: plain.length };
}

function fileAssetUrl(fileId) {
  if (!fileId) return '';
  return `${API_URL}/assets/${encodeURIComponent(fileId)}`;
}

export function RichTextEditor({
  value = '',
  onChange,
  files = [],
  required = false,
  disabled = false,
}) {
  const { t } = useI18n();
  const editorRef = useRef(null);
  const lastEmittedRef = useRef(null);
  const savedRangeRef = useRef(null);
  const [mode, setMode] = useState('visual');
  const [blockTag, setBlockTag] = useState('P');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [imageOpen, setImageOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [selectedFileId, setSelectedFileId] = useState('');

  const imageFiles = useMemo(
    () => (files ?? []).filter((file) => String(file?.mimetype || '').startsWith('image/')),
    [files],
  );
  const stats = useMemo(() => countStats(value), [value]);

  useEffect(() => {
    const incoming = value ?? '';
    if (editorRef.current && incoming !== lastEmittedRef.current) {
      editorRef.current.innerHTML = incoming;
      lastEmittedRef.current = incoming;
    }
  }, [value, mode]);

  useEffect(() => {
    if (mode === 'visual' && editorRef.current) {
      const current = value ?? '';
      if (editorRef.current.innerHTML !== current) {
        editorRef.current.innerHTML = current;
      }
      lastEmittedRef.current = current;
    }
  }, [mode]);

  function saveSelection() {
    if (typeof window === 'undefined') return;
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (editorRef.current?.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  }

  function restoreSelection() {
    if (typeof window === 'undefined' || !savedRangeRef.current) return;
    const selection = window.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(savedRangeRef.current);
  }

  function emitVisualChange() {
    if (!editorRef.current) return;
    const nextHtml = editorRef.current.innerHTML;
    lastEmittedRef.current = nextHtml;
    onChange?.(nextHtml);
  }

  function runCommand(command, argument = null) {
    if (disabled) return;
    if (mode !== 'visual') {
      setMode('visual');
      return;
    }
    editorRef.current?.focus();
    restoreSelection();
    if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
      document.execCommand(command, false, argument);
    }
    saveSelection();
    emitVisualChange();
  }

  function applyBlockFormat(tag) {
    setBlockTag(tag);
    if (mode === 'visual') {
      runCommand('formatBlock', `<${tag}>`);
    } else {
      const tagLower = tag.toLowerCase();
      onChange?.(`${value || ''}\n<${tagLower}></${tagLower}>`);
    }
  }

  function wrapInlineCode() {
    if (disabled) return;
    if (mode !== 'visual') {
      onChange?.(`${value || ''}<code></code>`);
      return;
    }
    editorRef.current?.focus();
    restoreSelection();
    const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
    const selectedText = selection?.toString() || 'code';
    if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
      document.execCommand('insertHTML', false, `<code>${selectedText}</code>`);
    }
    saveSelection();
    emitVisualChange();
  }

  function insertLink() {
    const trimmedUrl = linkUrl.trim();
    if (!trimmedUrl) return;
    const label = linkText.trim() || trimmedUrl;
    const anchorHtml = `<a href="${trimmedUrl.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    if (mode === 'visual' && editorRef.current) {
      editorRef.current.focus();
      restoreSelection();
      if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
        document.execCommand('insertHTML', false, anchorHtml);
      } else {
        editorRef.current.innerHTML += anchorHtml;
      }
      emitVisualChange();
    } else {
      onChange?.(`${value || ''}${anchorHtml}`);
    }
    setLinkUrl('');
    setLinkText('');
    setLinkOpen(false);
  }

  function insertImage() {
    const resolvedUrl = selectedFileId ? fileAssetUrl(selectedFileId) : imageUrl.trim();
    if (!resolvedUrl) return;
    const selectedFile = imageFiles.find((file) => String(file.id) === String(selectedFileId));
    const alt = (selectedFile?.title || selectedFile?.filename_download || '').replace(/"/g, '&quot;');
    const imgHtml = `<img src="${resolvedUrl.replace(/"/g, '&quot;')}" alt="${alt}" loading="lazy" />`;
    if (mode === 'visual' && editorRef.current) {
      editorRef.current.focus();
      restoreSelection();
      if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
        document.execCommand('insertHTML', false, imgHtml);
      } else {
        editorRef.current.innerHTML += imgHtml;
      }
      emitVisualChange();
    } else {
      onChange?.(`${value || ''}\n${imgHtml}`);
    }
    setImageUrl('');
    setSelectedFileId('');
    setImageOpen(false);
  }

  return (
    <div className={`richtext-editor ${disabled ? 'is-disabled' : ''} richtext-mode-${mode}`} data-testid="richtext-editor">
      <div className="richtext-toolbar" role="toolbar" aria-label={t('fieldType.richtext')}>
        <div className="richtext-toolbar-group">
          <select
            className="richtext-block-select"
            value={blockTag}
            disabled={disabled}
            aria-label={t('richtext.paragraph')}
            onChange={(event) => applyBlockFormat(event.target.value)}
          >
            <option value="P">{t('richtext.paragraph')}</option>
            <option value="H1">{t('richtext.heading1')}</option>
            <option value="H2">{t('richtext.heading2')}</option>
            <option value="H3">{t('richtext.heading3')}</option>
            <option value="H4">{t('richtext.heading4')}</option>
            <option value="BLOCKQUOTE">{t('richtext.quote')}</option>
            <option value="PRE">{t('richtext.codeBlock')}</option>
          </select>
        </div>

        <div className="richtext-toolbar-group">
          <button type="button" className="richtext-tool-btn" title={t('richtext.bold')} aria-label={t('richtext.bold')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('bold')}>
            <strong>B</strong>
          </button>
          <button type="button" className="richtext-tool-btn" title={t('richtext.italic')} aria-label={t('richtext.italic')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('italic')}>
            <em>I</em>
          </button>
          <button type="button" className="richtext-tool-btn" title={t('richtext.underline')} aria-label={t('richtext.underline')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('underline')}>
            <u>U</u>
          </button>
          <button type="button" className="richtext-tool-btn" title={t('richtext.strike')} aria-label={t('richtext.strike')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('strikeThrough')}>
            <s>S</s>
          </button>
          <button type="button" className="richtext-tool-btn" title={t('richtext.inlineCode')} aria-label={t('richtext.inlineCode')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={wrapInlineCode}>
            <code>{'<>'}</code>
          </button>
        </div>

        <div className="richtext-toolbar-group">
          <button type="button" className="richtext-tool-btn" title={t('richtext.bulletList')} aria-label={t('richtext.bulletList')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('insertUnorderedList')}>
            •≡
          </button>
          <button type="button" className="richtext-tool-btn" title={t('richtext.orderedList')} aria-label={t('richtext.orderedList')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('insertOrderedList')}>
            1≡
          </button>
          <button type="button" className="richtext-tool-btn" title={t('richtext.alignLeft')} aria-label={t('richtext.alignLeft')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('justifyLeft')}>
            ⫷
          </button>
          <button type="button" className="richtext-tool-btn" title={t('richtext.alignCenter')} aria-label={t('richtext.alignCenter')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('justifyCenter')}>
            ≡
          </button>
          <button type="button" className="richtext-tool-btn" title={t('richtext.alignRight')} aria-label={t('richtext.alignRight')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('justifyRight')}>
            ⫸
          </button>
        </div>

        <div className="richtext-toolbar-group">
          <button
            type="button"
            className={`richtext-tool-btn ${linkOpen ? 'active' : ''}`}
            title={t('richtext.insertLink')}
            aria-label={t('richtext.insertLink')}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              saveSelection();
              setImageOpen(false);
              setLinkOpen((open) => !open);
            }}
          >
            🔗
          </button>
          <button
            type="button"
            className={`richtext-tool-btn ${imageOpen ? 'active' : ''}`}
            title={t('richtext.insertImage')}
            aria-label={t('richtext.insertImage')}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              saveSelection();
              setLinkOpen(false);
              setImageOpen((open) => !open);
            }}
          >
            🖼
          </button>
          <button type="button" className="richtext-tool-btn" title={t('richtext.divider')} aria-label={t('richtext.divider')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('insertHorizontalRule')}>
            ―
          </button>
          <button type="button" className="richtext-tool-btn" title={t('richtext.clearFormat')} aria-label={t('richtext.clearFormat')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('removeFormat')}>
            Tx
          </button>
          <button type="button" className="richtext-tool-btn" title={t('richtext.undo')} aria-label={t('richtext.undo')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('undo')}>
            ↶
          </button>
          <button type="button" className="richtext-tool-btn" title={t('richtext.redo')} aria-label={t('richtext.redo')} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('redo')}>
            ↷
          </button>
        </div>

        <div className="richtext-mode-switch" role="group" aria-label={t('fieldType.richtext')}>
          <button
            type="button"
            className={mode === 'visual' ? 'active' : ''}
            onClick={() => setMode('visual')}
          >
            {t('richtext.visual')}
          </button>
          <button
            type="button"
            className={mode === 'html' ? 'active' : ''}
            onClick={() => setMode('html')}
          >
            {t('richtext.html')}
          </button>
          <button
            type="button"
            className={mode === 'split' ? 'active' : ''}
            onClick={() => setMode('split')}
          >
            {t('richtext.split')}
          </button>
        </div>
      </div>

      {linkOpen && (
        <div className="richtext-popover-bar">
          <input
            type="text"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder={t('richtext.linkUrlPlaceholder')}
          />
          <input
            type="text"
            value={linkText}
            onChange={(event) => setLinkText(event.target.value)}
            placeholder={t('richtext.linkTextPlaceholder')}
          />
          <button type="button" className="secondary-button" onClick={insertLink}>
            {t('richtext.applyLink')}
          </button>
          <button type="button" className="text-button" onClick={() => setLinkOpen(false)}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {imageOpen && (
        <div className="richtext-popover-bar">
          {imageFiles.length > 0 && (
            <select
              value={selectedFileId}
              onChange={(event) => setSelectedFileId(event.target.value)}
              aria-label={t('richtext.imageFromLibrary')}
            >
              <option value="">{t('richtext.imageFromLibrary')}</option>
              {imageFiles.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.title || file.filename_download || file.id}
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder={t('richtext.imageUrlPlaceholder')}
          />
          <button type="button" className="secondary-button" onClick={insertImage}>
            {t('richtext.insertImageAction')}
          </button>
          <button type="button" className="text-button" onClick={() => setImageOpen(false)}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      <div className="richtext-body">
        {mode === 'visual' && (
          <div
            ref={editorRef}
            className="richtext-visual-surface"
            data-testid="richtext-visual"
            contentEditable={!disabled}
            role="textbox"
            aria-multiline="true"
            suppressContentEditableWarning
            onInput={emitVisualChange}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onBlur={emitVisualChange}
          />
        )}

        {mode === 'html' && (
          <textarea
            className="richtext-html-source"
            data-testid="richtext-source"
            rows={14}
            value={value ?? ''}
            disabled={disabled}
            required={required}
            onChange={(event) => {
              const nextValue = event.target.value;
              lastEmittedRef.current = nextValue;
              onChange?.(nextValue);
            }}
          />
        )}

        {mode === 'split' && (
          <div className="richtext-split-grid">
            <textarea
              className="richtext-html-source"
              data-testid="richtext-source"
              rows={14}
              value={value ?? ''}
              disabled={disabled}
              required={required}
              onChange={(event) => {
                const nextValue = event.target.value;
                lastEmittedRef.current = nextValue;
                onChange?.(nextValue);
              }}
            />
            <div className="richtext-split-preview">
              <div className="richtext-split-preview-header">{t('richtext.preview')}</div>
              {value ? (
                <div
                  className="richtext-visual-surface richtext-preview-only"
                  data-testid="richtext-visual"
                  dangerouslySetInnerHTML={{ __html: value }}
                />
              ) : (
                <p className="richtext-preview-empty">{t('richtext.emptyPreview')}</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="richtext-footer">
        <small>{t('richtext.stats', stats)}</small>
        <code>HTML</code>
      </div>
    </div>
  );
}
