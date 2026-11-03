// Keep complete values available to assistive technology and native tooltips.
// Visual clipping belongs to the shared table system, never to stored values.
export function TableCellText({ children, multiline = false, code = false }) {
  const Tag = code ? 'code' : 'span';
  return <Tag className={`table-cell-text${multiline ? ' is-multiline' : ''}`} title={String(children ?? '')}>{children}</Tag>;
}
