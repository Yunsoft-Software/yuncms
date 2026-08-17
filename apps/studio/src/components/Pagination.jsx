import { useI18n } from '../i18n.js';

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

function paginationItems(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages = new Set([1, totalPages, page - 2, page - 1, page, page + 1, page + 2]);
  const sorted = [...pages]
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((left, right) => left - right);

  const items = [];
  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];
    if (previous && value - previous > 1) items.push(`ellipsis-${previous}-${value}`);
    items.push(value);
  });
  return items;
}

export function Pagination({
  page = 1,
  pageSize = 25,
  totalItems = 0,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  onPageChange,
  onPageSizeChange,
  loading = false,
  compact = false,
  itemLabel,
}) {
  const { t } = useI18n();
  const label = itemLabel || t('pagination.items');
  const normalizedTotal = Math.max(0, Number(totalItems) || 0);
  const normalizedPageSize = Math.max(1, Number(pageSize) || 1);
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / normalizedPageSize));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = normalizedTotal === 0 ? 0 : ((currentPage - 1) * normalizedPageSize) + 1;
  const end = Math.min(currentPage * normalizedPageSize, normalizedTotal);
  const items = paginationItems(currentPage, totalPages);

  function changePage(nextPage) {
    const target = Math.min(Math.max(1, nextPage), totalPages);
    if (target !== currentPage && !loading) onPageChange?.(target);
  }

  return (
    <nav className={`pagination ${compact ? 'pagination-compact' : ''}`} aria-label={t('pagination.aria', { label })}>
      <div className="pagination-summary" aria-live="polite">
        <strong>{start}–{end}</strong>
        <span>{t('pagination.ofTotal', { total: normalizedTotal, label })}</span>
      </div>

      <div className="pagination-controls">
        <button
          className="pagination-button pagination-arrow"
          type="button"
          disabled={currentPage <= 1 || loading}
          onClick={() => changePage(currentPage - 1)}
          aria-label={t('pagination.previousPage')}
        >
          ‹
        </button>

        <div className="pagination-pages" aria-label={t('pagination.pageOf', { page: currentPage, totalPages })}>
          {items.map((item) => typeof item === 'number' ? (
            <button
              className={`pagination-button ${item === currentPage ? 'active' : ''}`}
              key={item}
              type="button"
              disabled={loading}
              aria-current={item === currentPage ? 'page' : undefined}
              aria-label={t('pagination.page', { page: item })}
              onClick={() => changePage(item)}
            >
              {item}
            </button>
          ) : (
            <span className="pagination-ellipsis" key={item} aria-hidden="true">…</span>
          ))}
        </div>

        <button
          className="pagination-button pagination-arrow"
          type="button"
          disabled={currentPage >= totalPages || loading}
          onClick={() => changePage(currentPage + 1)}
          aria-label={t('pagination.nextPage')}
        >
          ›
        </button>
      </div>

      {onPageSizeChange && (
        <label className="pagination-size">
          <span>{t('pagination.perPage')}</span>
          <select
            value={normalizedPageSize}
            disabled={loading}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      )}
    </nav>
  );
}

export function paginateClientItems(items, page, pageSize) {
  const normalizedPageSize = Math.max(1, Number(pageSize) || 1);
  const totalPages = Math.max(1, Math.ceil(items.length / normalizedPageSize));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (currentPage - 1) * normalizedPageSize;
  return {
    page: currentPage,
    totalPages,
    items: items.slice(start, start + normalizedPageSize),
  };
}
