import assert from 'node:assert/strict';
import test from 'node:test';

import { singletonDestination } from '../src/singleton-route.js';

test('regular collections keep the normal list route', () => {
  assert.equal(singletonDestination('articles', { singleton: false }, []), null);
});

test('singleton collections with an item open that item directly', () => {
  assert.equal(
    singletonDestination('site_settings', { singleton: true, primary_key: 'id' }, [{ id: 'settings-1' }]),
    '#/content/site_settings/settings-1',
  );
});

test('empty singleton collections open the create form', () => {
  assert.equal(
    singletonDestination('site_settings', { singleton: true, primary_key: 'id' }, []),
    '#/content/site_settings/new',
  );
});

test('singleton routing respects a custom primary key', () => {
  assert.equal(
    singletonDestination('profile', { singleton: true, primary_key: 'key' }, [{ key: 'main' }]),
    '#/content/profile/main',
  );
});
