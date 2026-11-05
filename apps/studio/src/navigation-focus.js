// Resolve every Tab step explicitly: native Safari tab preferences may skip
// links, which would otherwise bypass the DOM boundary of a modal drawer.
export function nextNavigationFocusIndex(count, current, reverse = false) {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return reverse ? count - 1 : 0;
  return (current + (reverse ? -1 : 1) + count) % count;
}
