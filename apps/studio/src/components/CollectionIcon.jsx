import { normalizeCollectionIcon } from '../collection-icons.js';

const PATHS = {
  collection: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11"/></>,
  article: <><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 12h7M9 16h7"/></>,
  folder: <path d="M3 7h6l2-2h10v14H3z"/>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 18 5-5 3 3 3-3 4 5"/></>,
  user: <><circle cx="12" cy="8" r="3"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17.5" cy="9" r="2"/><path d="M15.5 14.5a4 4 0 0 1 5 3.5"/></>,
  company: <><path d="M4 21V5h10v16M14 9h6v12"/><path d="M7 9h3M7 13h3M7 17h3M17 13h1M17 17h1"/></>,
  cart: <><path d="M3 4h2l2 11h10l3-8H6"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></>,
  product: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>,
  tag: <><path d="M3 11V4h7l11 11-6 6z"/><circle cx="7.5" cy="7.5" r="1.2"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>,
  check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M8 10h8M8 14h8"/></>,
  message: <path d="M4 5h16v11H9l-5 4z"/>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
  phone: <path d="M7 3h3l1.5 5-2 1.5a14 14 0 0 0 5 5l1.5-2L21 14v3c0 2-1 4-4 4C9.3 21 3 14.7 3 7c0-3 2-4 4-4z"/>,
  location: <><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.3"/></>,
  link: <><path d="M9.5 14.5 7 17a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0"/><path d="m14.5 9.5 2.5-2.5a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0M8 12h8"/></>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>,
  heart: <path d="M12 20 4.5 12.8A5 5 0 0 1 12 6a5 5 0 0 1 7.5 6.8z"/>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  money: <><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5c-.8-1-2-1.5-3.5-1.5-2 0-3.5 1-3.5 2.5s1.4 2.2 3.5 2.5 3.5 1 3.5 2.5S14 17 12 17c-1.5 0-2.8-.5-3.6-1.5M12 5v14"/></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 12h18"/></>,
  truck: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></>,
  factory: <><path d="M3 21V10l6 3V9l6 4V5h6v16z"/><path d="M7 17h2M12 17h2M17 17h2"/></>,
  wrench: <path d="M14.5 5.5a5 5 0 0 0-6 6L3 17l4 4 5.5-5.5a5 5 0 0 0 6-6l-3 3-4-4z"/>,
  shield: <><path d="M12 3 19 6v5c0 4.7-3 7.7-7 9.5C8 18.7 5 15.7 5 11V6z"/><path d="m9 12 2 2 4-4"/></>,
  key: <><circle cx="8" cy="12" r="4"/><path d="M12 12h9M17 12v3M20 12v2"/></>,
  code: <><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></>,
  book: <><path d="M4 4h7a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 1z"/><path d="M20 4h-3a3 3 0 0 0-3 3v13h3a3 3 0 0 1 3 1z"/></>,
  graduation: <><path d="m3 9 9-5 9 5-9 5z"/><path d="M7 12v4c2 2 8 2 10 0v-4M21 9v6"/></>,
};

export function CollectionIcon({ name, size = 18, className = '' }) {
  const normalized = normalizeCollectionIcon(name);
  return (
    <svg
      className={`collection-icon ${className}`.trim()}
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
      {PATHS[normalized] || PATHS.collection}
    </svg>
  );
}
