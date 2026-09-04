const TOP_LEVEL_SECTIONS = new Set(['ai', 'appearance', 'files', 'mcp', 'roles', 'users']);

function decode(value = '') {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encode(value = '') {
  return encodeURIComponent(String(value));
}

export function readStudioRoute(hash = window.location.hash) {
  const path = String(hash || '').replace(/^#\/?/, '');
  const segments = path.split('/').filter(Boolean).map(decode);
  const [section = 'content', first = '', second = '', third = '', fourth = ''] = segments;

  if (section === 'content') {
    return {
      section,
      collection: first,
      view: second === 'new' ? 'new' : second ? 'record' : 'list',
      recordId: second && second !== 'new' ? second : '',
    };
  }

  if (section === 'data-model') {
    if (!first) return { section, view: 'collections', collection: '', field: '' };
    if (first === '~graph') return { section, view: 'graph', collection: '', field: '' };
    if (first === 'new') return { section, view: 'new-collection', collection: '', field: '' };
    if (!second || second === 'overview') return { section, view: 'overview', collection: first, field: '' };
    if (second === 'fields') {
      if (!third) return { section, view: 'fields', collection: first, field: '' };
      if (third === 'new') return { section, view: 'new-field', collection: first, field: '' };
      return { section, view: 'field', collection: first, field: third };
    }
    if (second === 'relations') {
      return { section, view: third === 'new' ? 'new-relation' : 'relations', collection: first, field: '', relationKind: fourth || '' };
    }
    return { section, view: 'overview', collection: first, field: '' };
  }

  if (section === 'roles') {
    if (!first) return { section, view: 'list', roleId: '', collection: '', action: '' };
    if (first === 'new') return { section, view: 'new', roleId: '', collection: '', action: '' };
    if (second === 'permissions' && third && fourth) {
      return { section, view: 'permission', roleId: first, collection: third, action: fourth };
    }
    return { section, view: 'detail', roleId: first, collection: '', action: '' };
  }

  if (section === 'files') {
    return { section, view: first === 'new' ? 'new' : first ? 'detail' : 'list', fileId: first && first !== 'new' ? first : '' };
  }

  if (section === 'users') {
    return { section, view: first === 'new' ? 'new' : first ? 'detail' : 'list', userId: first && first !== 'new' ? first : '' };
  }

  if (TOP_LEVEL_SECTIONS.has(section)) return { section, view: 'list' };
  return { section: 'content', collection: '', view: 'list', recordId: '' };
}

export const studioPath = Object.freeze({
  content: (collection = '') => `#/content${collection ? `/${encode(collection)}` : ''}`,
  contentNew: (collection) => `#/content/${encode(collection)}/new`,
  contentRecord: (collection, id) => `#/content/${encode(collection)}/${encode(id)}`,
  dataModel: () => '#/data-model',
  schemaGraph: () => '#/data-model/~graph',
  newCollection: () => '#/data-model/new',
  collection: (collection) => `#/data-model/${encode(collection)}/overview`,
  fields: (collection) => `#/data-model/${encode(collection)}/fields`,
  newField: (collection) => `#/data-model/${encode(collection)}/fields/new`,
  field: (collection, field) => `#/data-model/${encode(collection)}/fields/${encode(field)}`,
  relations: (collection) => `#/data-model/${encode(collection)}/relations`,
  newRelation: (collection, kind = 'm2o') => `#/data-model/${encode(collection)}/relations/new/${encode(kind)}`,
  roles: () => '#/roles',
  newRole: () => '#/roles/new',
  role: (roleId) => `#/roles/${encode(roleId)}`,
  permission: (roleId, collection, action) => `#/roles/${encode(roleId)}/permissions/${encode(collection)}/${encode(action)}`,
  files: () => '#/files',
  newFile: () => '#/files/new',
  file: (fileId) => `#/files/${encode(fileId)}`,
  users: () => '#/users',
  newUser: () => '#/users/new',
  user: (userId) => `#/users/${encode(userId)}`,
  ai: () => '#/ai',
  mcp: () => '#/mcp',
  appearance: () => '#/appearance',
});

export function navigateStudio(path, { replace = false } = {}) {
  const next = String(path || '#/content');
  if (window.location.hash === next) return;
  if (replace) {
    const url = new URL(window.location.href);
    url.hash = next.slice(1);
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  window.location.hash = next.slice(1);
}
