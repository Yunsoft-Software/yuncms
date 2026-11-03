import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRelationLookup } from '../src/content-access.js';
import {
  buildInitialNestedDraft,
  discoverNestedRelations,
  loadNestedRecordRows,
  loadNestedSummariesForItems,
  nestedRelationsHaveFiles,
  saveNestedRelations,
  searchNestedParentIds,
  slugifyText,
  virtualRelationColumns,
} from '../src/content-relations.js';
import {
  fieldCreationPayload,
  fieldDisplayType,
  isRichTextField,
  isSelectDropdownField,
  selectChoicesForField,
} from '../src/field-ui.js';

const MOCK_RELATIONS = [
  {
    id: 'rel-blogs-tr',
    many_collection: 'blogs_translations',
    many_field: 'blogs_id',
    one_collection: 'blogs',
    one_field: 'id',
    metadata: { kind: 'm2o', reverseField: 'translations' },
  },
  {
    id: 'rel-blogs-lang',
    many_collection: 'blogs_translations',
    many_field: 'languages_code',
    one_collection: 'languages',
    one_field: 'code',
    metadata: { kind: 'm2o' },
  },
  {
    id: 'rel-blogs-cat-left',
    many_collection: 'blogs_blog_categories',
    many_field: 'blogs_id',
    one_collection: 'blogs',
    one_field: 'id',
    junction_collection: 'blogs_blog_categories',
    junction_field: 'blog_categories_id',
    metadata: { kind: 'm2m', reverseField: 'categories' },
  },
  {
    id: 'rel-blogs-cat-right',
    many_collection: 'blogs_blog_categories',
    many_field: 'blog_categories_id',
    one_collection: 'blog_categories',
    one_field: 'id',
    junction_collection: 'blogs_blog_categories',
    junction_field: 'blogs_id',
    metadata: { kind: 'm2m' },
  },
  {
    id: 'rel-cat-tr',
    many_collection: 'blog_categories_translations',
    many_field: 'blog_categories_id',
    one_collection: 'blog_categories',
    one_field: 'id',
    metadata: { kind: 'm2o', reverseField: 'translations' },
  },
  {
    id: 'rel-slider-files',
    many_collection: 'slider_files',
    many_field: 'slider_id',
    one_collection: 'slider',
    one_field: 'id',
    metadata: { kind: 'm2o', reverseField: 'images' },
  },
];

function createMockRequest() {
  const calls = [];
  const state = {
    translations: [
      {
        id: 101,
        blogs_id: 'blog-1',
        languages_code: 'tr-TR',
        title: 'Klinik Karar Destek Sistemleri',
        slug: 'klinik-karar-destek-sistemleri',
        excerpt: 'Özet TR',
        content: '<p>Merhaba <strong>Dünya</strong></p>',
        image: 'file-1',
      },
      {
        id: 102,
        blogs_id: 'blog-1',
        languages_code: 'en-US',
        title: 'Clinical Decision Support Systems',
        slug: 'clinical-decision-support-systems',
        excerpt: 'Summary EN',
        content: '<p>Hello <strong>World</strong></p>',
        image: 'file-1',
      },
    ],
    junctions: [
      { id: 1, blogs_id: 'blog-1', blog_categories_id: 'cat-1' },
    ],
  };

  async function request(path, options = {}) {
    calls.push({ path, options });
    if (path.includes('/collections/blogs_translations/fields')) {
      return {
        data: [
          { field: 'id', type: 'integer', readonly: true },
          { field: 'blogs_id', type: 'uuid' },
          { field: 'languages_code', type: 'string' },
          { field: 'title', type: 'string' },
          { field: 'slug', type: 'string' },
          { field: 'excerpt', type: 'text' },
          { field: 'content', type: 'text', interface: 'wysiwyg' },
          { field: 'image', type: 'uuid', interface: 'image' },
        ],
      };
    }
    if (path.includes('/collections/blogs_translations/capabilities')) {
      return { data: { create: { allowed: true }, update: { allowed: true }, delete: { allowed: true } } };
    }
    if (path.includes('/collections/blog_categories/fields')) {
      return {
        data: [{ field: 'id', type: 'uuid', readonly: true }],
      };
    }
    if (path.includes('/collections/blog_categories_translations/fields')) {
      return {
        data: [
          { field: 'id', type: 'integer', readonly: true },
          { field: 'blog_categories_id', type: 'uuid' },
          { field: 'languages_code', type: 'string' },
          { field: 'title', type: 'string' },
        ],
      };
    }
    if (path.includes('/collections/slider_files/fields')) {
      return {
        data: [
          { field: 'id', type: 'integer', readonly: true },
          { field: 'slider_id', type: 'uuid' },
          { field: 'directus_files_id', type: 'uuid', interface: 'image' },
        ],
      };
    }
    if (path.startsWith('/items/languages')) {
      return {
        data: [
          { code: 'tr-TR', name: 'Turkish' },
          { code: 'en-US', name: 'English' },
        ],
      };
    }
    if (path.startsWith('/items/blog_categories?')) {
      return {
        data: [{ id: 'cat-1' }, { id: 'cat-2' }],
      };
    }
    if (path.startsWith('/items/blog_categories_translations?')) {
      return {
        data: [
          { id: 1, blog_categories_id: 'cat-1', languages_code: 'tr-TR', title: 'Sağlık Teknolojileri' },
          { id: 2, blog_categories_id: 'cat-1', languages_code: 'en-US', title: 'HealthTech' },
          { id: 3, blog_categories_id: 'cat-2', languages_code: 'tr-TR', title: 'Yapay Zeka' },
          { id: 4, blog_categories_id: 'cat-2', languages_code: 'en-US', title: 'AI' },
        ],
      };
    }
    if (path.startsWith('/items/blogs_translations')) {
      if (options.method === 'PATCH' || options.method === 'POST' || options.method === 'DELETE') {
        return { data: options.body || {} };
      }
      return { data: state.translations };
    }
    if (path.startsWith('/items/blogs_blog_categories')) {
      if (options.method === 'POST' || options.method === 'DELETE') {
        return { data: options.body || {} };
      }
      return { data: state.junctions };
    }
    return { data: [] };
  }

  return { request, calls };
}

test('slugifyText converts Turkish characters and punctuation into clean URL slugs', () => {
  assert.equal(
    slugifyText('Sağlıkta Yapay Zeka & Klinik Karar Destek Sistemleri: 2026!'),
    'saglikta-yapay-zeka-klinik-karar-destek-sistemleri-2026',
  );
  assert.equal(slugifyText('İletişim / Hakkımızda'), 'iletisim-hakkimizda');
  assert.equal(slugifyText('/Kariyer ve İletişim', { preserveLeadingSlash: true }), '/kariyer-ve-iletisim');
});

test('RichText and SelectDropdown field helpers identify WYSIWYG and dropdown fields', () => {
  const wysiwygField = { field: 'content', type: 'text', interface: 'wysiwyg' };
  const richTextField = { field: 'body', type: 'text', interface: 'richtext' };
  const plainTextField = { field: 'excerpt', type: 'text', interface: 'input-multiline' };

  assert.equal(isRichTextField(wysiwygField), true);
  assert.equal(isRichTextField(richTextField), true);
  assert.equal(isRichTextField(plainTextField), false);
  assert.equal(fieldDisplayType(wysiwygField), 'richtext');

  const payload = fieldCreationPayload({
    name: 'Body HTML',
    field: 'body_html',
    type: 'richtext',
    required: true,
  });
  assert.equal(payload.type, 'text');
  assert.equal(payload.interface, 'richtext');

  const statusField = { field: 'status', type: 'string', interface: 'select-dropdown' };
  assert.equal(isSelectDropdownField(statusField), true);
  assert.equal(selectChoicesForField(statusField).length, 3);
});

test('loadRelationLookup resolves translated labels when target collection only has id', async () => {
  const { request } = createMockRequest();
  const [, lookup] = await loadRelationLookup(
    {
      many_field: 'blog_categories_id',
      one_collection: 'blog_categories',
      one_field: 'id',
    },
    { isAdmin: true, request },
  );

  assert.equal(lookup.labelField, '_translated_label');
  const first = lookup.items.find((item) => item.id === 'cat-1');
  assert.ok(first._translated_label.includes('Sağlık Teknolojileri'));
  assert.ok(first._translated_label.includes('HealthTech'));
});

test('discoverNestedRelations discovers translations, m2m, and o2m relations and builds summaries', async () => {
  const { request } = createMockRequest();
  const nested = await discoverNestedRelations('blogs', MOCK_RELATIONS, { isAdmin: true, request });

  assert.equal(nested.length, 2);
  assert.equal(nested[0].kind, 'translations');
  assert.equal(nested[0].childCollection, 'blogs_translations');
  assert.equal(nested[0].languageField, 'languages_code');
  assert.equal(nested[1].kind, 'm2m');
  assert.equal(nested[1].junctionCollection, 'blogs_blog_categories');
  assert.equal(nested[1].targetCollection, 'blog_categories');
  assert.equal(nestedRelationsHaveFiles(nested), true);

  const columns = virtualRelationColumns(nested, (key) => key);
  assert.equal(columns.length, 2);
  assert.equal(columns[0].virtualRelation.kind, 'translations');

  const summaries = await loadNestedSummariesForItems(nested, [{ id: 'blog-1' }], { request });
  assert.equal(summaries[nested[0].key]['blog-1'].length, 2);
  assert.equal(summaries[nested[0].key]['blog-1'][0].title, 'Klinik Karar Destek Sistemleri');
  assert.equal(summaries[nested[1].key]['blog-1'].length, 1);

  const matchedIds = await searchNestedParentIds(nested, 'Klinik', { request });
  assert.deepEqual(matchedIds, ['blog-1']);
});

test('saveNestedRelations persists translation updates and M2M junction changes', async () => {
  const { request, calls } = createMockRequest();
  const nested = await discoverNestedRelations('blogs', MOCK_RELATIONS, { isAdmin: true, request });
  const existing = await loadNestedRecordRows(nested, 'blog-1', { request });
  const draft = buildInitialNestedDraft(nested, existing);

  // Modify Turkish title and switch category from cat-1 to cat-2
  draft[nested[0].key]['tr-TR'].values.title = 'Güncellenmiş Başlık';
  draft[nested[1].key] = ['cat-2'];

  calls.length = 0;
  await saveNestedRelations({
    parentId: 'blog-1',
    nestedRelations: nested,
    draftState: draft,
    existingRowsByKey: existing,
    request,
  });

  const patchCalls = calls.filter((entry) => entry.options.method === 'PATCH');
  const postCalls = calls.filter((entry) => entry.options.method === 'POST');
  const deleteCalls = calls.filter((entry) => entry.options.method === 'DELETE');

  assert.equal(patchCalls.length, 2);
  assert.equal(patchCalls[0].path, '/items/blogs_translations/101');
  assert.equal(patchCalls[0].options.body.title, 'Güncellenmiş Başlık');
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].path, '/items/blogs_blog_categories');
  assert.deepEqual(postCalls[0].options.body, { blogs_id: 'blog-1', blog_categories_id: 'cat-2' });
  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0].path, '/items/blogs_blog_categories/1');
});
