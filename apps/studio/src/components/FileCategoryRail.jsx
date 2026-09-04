export function FileCategoryRail({ items = [], value, onChange, label }) {
  return (
    <aside className="file-category-rail" aria-label={label}>
      <strong className="file-category-rail-title">{label}</strong>
      <nav className="file-category-list">
        {items.map((item) => (
          <button
            key={item.value}
            className={item.value === value ? 'active' : ''}
            type="button"
            aria-current={item.value === value ? 'page' : undefined}
            onClick={() => onChange?.(item.value)}
          >
            <span>{item.label}</span>
            <small>{item.count}</small>
          </button>
        ))}
      </nav>
    </aside>
  );
}
