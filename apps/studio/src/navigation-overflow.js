export function hasHorizontalOverflow(element, tolerance = 1) {
  if (!element) return false;
  return Number(element.scrollWidth || 0) - Number(element.clientWidth || 0) > tolerance;
}

export function navigationTooltipPosition(rect, {
  viewportWidth = 0,
  viewportHeight = 0,
  preferredWidth = 320,
  margin = 12,
  gap = 8,
} = {}) {
  const width = Math.max(0, Math.min(preferredWidth, viewportWidth - (margin * 2)));
  const fitsRight = rect.right + gap + width <= viewportWidth - margin;
  const left = fitsRight
    ? rect.right + gap
    : Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
  const top = fitsRight
    ? Math.max(margin, Math.min(rect.top, viewportHeight - 104))
    : Math.max(margin, Math.min(rect.bottom + gap, viewportHeight - 104));

  return { left, top, maxWidth: width };
}
