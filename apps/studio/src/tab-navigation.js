export function tabTargetIndex(key, index, count) {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  const current = Number.isSafeInteger(index) && index >= 0 && index < count ? index : 0;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current + count - 1) % count;
  return null;
}
