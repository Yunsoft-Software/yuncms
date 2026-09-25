import assert from 'node:assert/strict';
import test from 'node:test';

import { hasHorizontalOverflow, navigationTooltipPosition } from '../src/navigation-overflow.js';

test('navigation labels report only meaningful horizontal overflow', () => {
  assert.equal(hasHorizontalOverflow({ scrollWidth: 180, clientWidth: 120 }), true);
  assert.equal(hasHorizontalOverflow({ scrollWidth: 121, clientWidth: 120 }), false);
  assert.equal(hasHorizontalOverflow({ scrollWidth: 120, clientWidth: 120 }), false);
});

test('navigation tooltip prefers the free space beside the sidebar item', () => {
  assert.deepEqual(
    navigationTooltipPosition(
      { left: 20, right: 220, top: 80, bottom: 114 },
      { viewportWidth: 1280, viewportHeight: 800 },
    ),
    { left: 228, top: 80, maxWidth: 320 },
  );
});

test('navigation tooltip stays inside narrow viewports', () => {
  assert.deepEqual(
    navigationTooltipPosition(
      { left: 12, right: 348, top: 80, bottom: 114 },
      { viewportWidth: 360, viewportHeight: 640 },
    ),
    { left: 12, top: 122, maxWidth: 320 },
  );
});
