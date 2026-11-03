import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { loadRelationLookup, normalizeRecordPrimaryKey, primaryKeyFieldForFields } from '../src/content-access.js';

const SRC = resolve(import.meta.dirname, '../src');
const contentSource = readFileSync(resolve(SRC, 'screens/ContentScreen.jsx'), 'utf8');
const valueCss = readFileSync(resolve(SRC, 'content-values.css'), 'utf8');

test('Content renders booleans, dates and statuses as typed values', () => {
  assert.match(contentSource, /field\.type === 'boolean'/);
  assert.match(contentSource, /content-value-boolean/);
  assert.match(contentSource, /formatDateFieldValue/);
  assert.match(contentSource, /content-value-date/);
  assert.match(contentSource, /field\.field === 'status'/);
  assert.match(contentSource, /content-value-status/);
});

test('Content typed values remain readable without color alone', () => {
  assert.match(contentSource, /t\(value \? 'common\.yes' : 'common\.no'\)/);
  assert.match(contentSource, /<time className="content-value-date"/);
  assert.match(contentSource, /content-value-empty/);
  assert.match(valueCss, /\.content-value-boolean\.is-true/);
  assert.match(valueCss, /\.content-value-status/);
});

test('Content relation lookups use dedicated endpoints for yuncms_users and yuncms_files instead of /items', async () => {
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    if (path === '/users?limit=200') {
      return { data: [{ id: 'u-1', email: 'editor@yunsoft.com' }] };
    }
    if (path === '/files?limit=200') {
      return { data: [{ id: 'f-1', title: null, filename_download: 'cover.webp' }] };
    }
    if (path === '/studio-navigation/collections/authors/fields') {
      return { data: [{ field: 'id', type: 'uuid' }, { field: 'name', type: 'string' }] };
    }
    if (path === '/items/authors?limit=200') {
      return { data: [{ id: 'a-1', name: 'Ada' }] };
    }
    throw new Error(`Unexpected path: ${path}`);
  };

  const [userField, userLookup] = await loadRelationLookup(
    { many_collection: 'blogs', many_field: 'user_created', one_collection: 'yuncms_users', one_field: 'id' },
    { isAdmin: true, request },
  );
  assert.equal(userField, 'user_created');
  assert.equal(userLookup.targetCollection, 'yuncms_users');
  assert.equal(userLookup.labelField, 'email');
  assert.deepEqual(userLookup.items, [{ id: 'u-1', email: 'editor@yunsoft.com' }]);

  const [fileField, fileLookup] = await loadRelationLookup(
    { many_collection: 'blogs_translations', many_field: 'image', one_collection: 'yuncms_files', one_field: 'id' },
    { isAdmin: true, request },
  );
  assert.equal(fileField, 'image');
  assert.equal(fileLookup.targetCollection, 'yuncms_files');
  assert.equal(fileLookup.labelField, 'title');
  assert.equal(fileLookup.items[0].title, 'cover.webp');

  const [authorField, authorLookup] = await loadRelationLookup(
    { many_collection: 'blogs', many_field: 'author_id', one_collection: 'authors', one_field: 'id' },
    { isAdmin: false, request },
  );
  assert.equal(authorField, 'author_id');
  assert.equal(authorLookup.labelField, 'name');
  assert.deepEqual(authorLookup.items, [{ id: 'a-1', name: 'Ada' }]);

  assert.equal(calls.some((path) => path.startsWith('/items/yuncms_')), false);

  const [deniedField, deniedLookup] = await loadRelationLookup(
    { many_collection: 'blogs', many_field: 'user_updated', one_collection: 'yuncms_users', one_field: 'id' },
    {
      isAdmin: false,
      request: async () => {
        throw new Error('Forbidden');
      },
    },
  );
  assert.equal(deniedField, 'user_updated');
  assert.equal(deniedLookup.labelField, 'email');
  assert.deepEqual(deniedLookup.items, []);

  const fields = [
    { field: 'code', type: 'string', schema_metadata: JSON.stringify({ primaryKey: true }) },
    { field: 'name', type: 'string' },
  ];
  assert.equal(primaryKeyFieldForFields(fields), 'code');
  assert.deepEqual(normalizeRecordPrimaryKey({ code: 'tr-TR', name: 'Türkçe' }, 'code'), {
    code: 'tr-TR',
    name: 'Türkçe',
    id: 'tr-TR',
  });
});
