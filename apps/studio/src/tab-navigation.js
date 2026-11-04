export function tabTargetIndex(key, index, count) {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  const current = Number.isSafeInteger(index) && index >= 0 && index < count ? index : 0;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current + count - 1) % count;
  return null;
}

export function tabRevealDelta(bounds, target, inset = 0) {
  const left = bounds.left + inset, right = bounds.right - inset;
  // Native scroll offsets can be integral even when layout rectangles are
  // fractional. Round away from zero so the selected tab is fully exposed.
  if (target.left < left) return Math.floor(target.left - left);
  if (target.right > right) return Math.ceil(target.right - right);
  return 0;
}
