import { expect } from '@playwright/test';

export async function waitForStudioPaint(page, name = 'Studio', { resetScroll = true } = {}) {
  await expect(page.locator('.studio-boot')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  // React can replace a logo source while a native request is in flight, and
  // Gecko can report complete before async off-main-thread bitmap decode settles.
  await expect.poll(() => page.locator('.studio-brand-logo, main img, [role="dialog"] img').evaluateAll(async images => {
    const pending = [];
    for (const image of images) {
      if (!image.isConnected || image.getClientRects().length === 0) continue;
      const srcBefore = image.currentSrc || image.src;
      if (!srcBefore || !image.complete || image.naturalWidth === 0) {
        pending.push(srcBefore || '<empty-src>');
        continue;
      }
      try {
        await image.decode();
        const srcAfter = image.currentSrc || image.src;
        if (srcAfter !== srcBefore || !image.complete || image.naturalWidth === 0) {
          pending.push(srcAfter || srcBefore);
        }
      } catch (error) {
        const srcAfter = image.currentSrc || image.src;
        pending.push(`${srcAfter || srcBefore} (${error?.message || 'decode-failed'})`);
      }
    }
    return pending;
  }), { message: `${name}: every visible image must load and decode`, timeout: 15000 }).toEqual([]);
  // A full-page capture can leave a restored scroll offset on the next hash
  // navigation. Keep the viewport proof at the top; full captures cover the rest.
  await page.evaluate(async shouldResetScroll => {
    const animations = document.getAnimations?.() ?? [];
    await Promise.all(
      animations
        .filter(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming?.().endTime))
        .map(animation => animation.finished.catch(() => {})),
    );
    if (shouldResetScroll) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, resetScroll);
}

export async function captureStudio(page, target, options) {
  await waitForStudioPaint(page, 'Studio', { resetScroll: false });
  return target.screenshot({ ...options, animations: 'disabled' });
}
