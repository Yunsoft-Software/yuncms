import { expect } from '@playwright/test';

// Composite actual rendered ancestor backgrounds, including translucent fills.
export async function expectReadableText(locator) {
  await expect(locator).toBeVisible();
  const ratio = await locator.evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const ancestors = []; for (let current = element; current; current = current.parentElement) ancestors.unshift(current);
    context.fillStyle = '#fff'; context.fillRect(0, 0, 1, 1);
    for (const ancestor of ancestors) { context.fillStyle = getComputedStyle(ancestor).backgroundColor; context.fillRect(0, 0, 1, 1); }
    const background = context.getImageData(0, 0, 1, 1).data;
    context.fillStyle = getComputedStyle(element).color; context.fillRect(0, 0, 1, 1);
    const foreground = context.getImageData(0, 0, 1, 1).data;
    const luminance = rgba => [...rgba].slice(0, 3).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const a = luminance(background), b = luminance(foreground);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(ratio, await locator.textContent()).toBeGreaterThanOrEqual(4.5);
}
