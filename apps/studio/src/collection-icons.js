export const COLLECTION_ICONS = Object.freeze([
  { id: 'collection', label: 'Collection', keywords: 'table data database records list' },
  { id: 'article', label: 'Article', keywords: 'article post blog content document text' },
  { id: 'folder', label: 'Folder', keywords: 'folder directory files archive' },
  { id: 'image', label: 'Image', keywords: 'image photo media gallery picture' },
  { id: 'user', label: 'User', keywords: 'user person member customer contact' },
  { id: 'users', label: 'Users', keywords: 'users team people members staff' },
  { id: 'company', label: 'Company', keywords: 'company business organization office' },
  { id: 'cart', label: 'Cart', keywords: 'cart commerce order sales shop ecommerce' },
  { id: 'product', label: 'Product', keywords: 'product box inventory item stock' },
  { id: 'tag', label: 'Tag', keywords: 'tag label category taxonomy' },
  { id: 'calendar', label: 'Calendar', keywords: 'calendar date event schedule booking' },
  { id: 'clock', label: 'Clock', keywords: 'clock time history activity' },
  { id: 'check', label: 'Check', keywords: 'check task todo approval done' },
  { id: 'clipboard', label: 'Clipboard', keywords: 'clipboard task form inspection checklist' },
  { id: 'message', label: 'Message', keywords: 'message chat comment conversation support' },
  { id: 'mail', label: 'Mail', keywords: 'mail email inbox newsletter' },
  { id: 'phone', label: 'Phone', keywords: 'phone call mobile contact' },
  { id: 'location', label: 'Location', keywords: 'location map place address pin' },
  { id: 'link', label: 'Link', keywords: 'link relation connection url' },
  { id: 'star', label: 'Star', keywords: 'star favorite featured rating' },
  { id: 'heart', label: 'Heart', keywords: 'heart like favorite health' },
  { id: 'chart', label: 'Chart', keywords: 'chart analytics report metric statistics' },
  { id: 'money', label: 'Money', keywords: 'money finance invoice payment accounting' },
  { id: 'briefcase', label: 'Briefcase', keywords: 'briefcase work job project business' },
  { id: 'truck', label: 'Truck', keywords: 'truck delivery shipping logistics' },
  { id: 'factory', label: 'Factory', keywords: 'factory manufacturing production machine' },
  { id: 'wrench', label: 'Wrench', keywords: 'wrench service maintenance settings tool' },
  { id: 'shield', label: 'Shield', keywords: 'shield security permission role protection' },
  { id: 'key', label: 'Key', keywords: 'key access credential token permission' },
  { id: 'code', label: 'Code', keywords: 'code api developer integration script' },
  { id: 'book', label: 'Book', keywords: 'book knowledge wiki documentation' },
  { id: 'graduation', label: 'Graduation', keywords: 'graduation education course student school' },
]);

export const DEFAULT_COLLECTION_ICON = 'collection';

export function findCollectionIcons(query = '') {
  const normalized = String(query).trim().toLowerCase();
  if (!normalized) return COLLECTION_ICONS;
  return COLLECTION_ICONS.filter((icon) => `${icon.id} ${icon.label} ${icon.keywords}`.toLowerCase().includes(normalized));
}

export function normalizeCollectionIcon(value) {
  return COLLECTION_ICONS.some((icon) => icon.id === value) ? value : DEFAULT_COLLECTION_ICON;
}
