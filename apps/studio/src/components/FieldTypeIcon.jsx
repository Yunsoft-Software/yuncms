const ICONS = Object.freeze({
  string: <><path d="M5 6h14M9 6v12M15 6v12M6 18h6M12 18h6" /></>,
  text: <><path d="M5 6h14M5 10h14M5 14h10M5 18h8" /></>,
  integer: <><path d="M7 8l2-2v12M14 7h4l-4 5h4l-4 5" /></>,
  bigint: <><path d="M5 8c0-2 2-3 4-3s4 1 4 3-2 3-4 3-4 1-4 3 2 4 4 4 4-2 4-4M15 7h4M17 5v4" /></>,
  decimal: <><path d="M6 8l2-2v12M12 17h.01M15 7h4l-4 5h4l-4 5" /></>,
  boolean: <><path d="M5 12l4 4L19 6" /></>,
  date: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 9h16" /></>,
  datetime: <><rect x="3" y="5" width="13" height="14" rx="2" /><path d="M7 3v4M12 3v4M3 9h13" /><circle cx="17" cy="16" r="4" /><path d="M17 14v2l1.5 1" /></>,
  timestamp: <><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></>,
  image: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M5 17l4-4 3 3 2-2 5 3" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></>,
  json: <><path d="M9 4c-2 0-3 1-3 3v2c0 2-1 3-3 3 2 0 3 1 3 3v2c0 2 1 3 3 3M15 4c2 0 3 1 3 3v2c0 2 1 3 3 3-2 0-3 1-3 3v2c0 2-1 3-3 3" /></>,
  uuid: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 13h5M8 17h3" /></>,
  user: <><circle cx="12" cy="8" r="3" /><path d="M5 20c.7-4 3.2-6 7-6s6.3 2 7 6" /></>,
  unknown: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.8 2.8 0 0 1 5 1.7c0 2-2.5 2.3-2.5 4M12 18h.01" /></>,
});

export function FieldTypeIcon({ type = 'unknown', size = 18, className = '' }) {
  return (
    <svg
      className={`field-type-icon-svg ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[type] || ICONS.unknown}
    </svg>
  );
}
