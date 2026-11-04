import assert from 'node:assert/strict';
import test from 'node:test';
import { StudioPaginationError, studioPagePath } from '../src/paged-data.js';

test('Studio page paths retain filters, Unicode and explicit sorting while replacing offsets', () => {
  const filter = JSON.stringify({ title: { _contains: 'العربية + Türkçe & 日本語' } });
  const path = studioPagePath(`/items/articles?filter=${encodeURIComponent(filter)}&sort=-title&offset=999&limit=5`, { offset: 400, limit: 200 });
  const parsed = new URL(path, 'http://localhost');
  assert.equal(parsed.pathname, '/items/articles');
  assert.equal(parsed.searchParams.get('filter'), filter);
  assert.equal(parsed.searchParams.get('sort'), '-title');
  assert.equal(parsed.searchParams.get('offset'), '400');
  assert.equal(parsed.searchParams.get('limit'), '200');
  assert.equal(new URL(studioPagePath('/users?offset=9'), 'http://localhost').searchParams.has('offset'), false);
});

test('a changed page set has a distinct error contract and never appears as a valid empty list', () => {
  const error = new StudioPaginationError();
  assert.equal(error.code, 'STUDIO_PAGINATION_CHANGED');
  assert.match(error.message, /Reload the record/);
});
