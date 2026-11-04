import { SidebarIcon } from './SidebarIcon.jsx';

export function TableRowActions({ actions = [] }) {
  return <div className="table-row-actions">
    {actions.filter(Boolean).map(({ label, icon, onClick, danger = false }) => (
      <button className={`table-action-button${danger ? ' is-danger' : ''}`} type="button" key={label} onClick={onClick} aria-label={label} title={label}>
        <SidebarIcon name={icon} size={16} />
      </button>
    ))}
  </div>;
}
