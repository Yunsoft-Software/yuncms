const PATHS = {
  content: <><path d="M4 5.5h16v13H4z"/><path d="M8 9h8M8 13h8"/></>,
  files: <><path d="M3.5 7h6l2-2h9v14h-17z"/><path d="M7 12h10"/></>,
  visibility: <><path d="M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5z"/><circle cx="12" cy="12" r="2.5"/></>,
  model: <><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/><path d="M10 7h4a3 3 0 0 1 3 3v4"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17.5" cy="9" r="2"/><path d="M15.5 14.5a4 4 0 0 1 5 3.5"/></>,
  roles: <><path d="M12 3.5 19 6v5c0 4.7-3 7.7-7 9.5C8 18.7 5 15.7 5 11V6z"/><path d="m9.2 12 1.8 1.8 3.8-4"/></>,
  appearance: <><circle cx="12" cy="12" r="3"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/></>,
  chevron: <path d="m9 6 6 6-6 6"/>,
  collapse: <><path d="M4 5h16v14H4z"/><path d="m14 9-3 3 3 3"/></>,
};

export function SidebarIcon({ name, size = 18 }) {
  return (
    <svg
      className="sidebar-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name] || PATHS.content}
    </svg>
  );
}
