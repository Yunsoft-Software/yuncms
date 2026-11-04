import { expect } from '@playwright/test';

export async function waitForStudioPaint(page, name = 'Studio') {
  await page.evaluate(() => document.fonts.ready);
  // React can replace a logo source while a native request is in flight.
  // Check the current image rather than decoding a superseded Firefox request.
  await expect.poll(() => page.locator('.studio-brand-logo, main img').evaluateAll(images => images
    .filter(image => !image.complete || image.naturalWidth === 0)
    .map(image => image.currentSrc || image.src)), { message: `${name}: every image must load` }).toEqual([]);
  // A full-page capture can leave a restored scroll offset on the next hash
  // navigation. Keep the viewport proof at the top; full captures cover the rest.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export async function captureStudio(page, target, options) {
  await waitForStudioPaint(page);
  return target.screenshot({ ...options, animations: 'disabled' });
}
