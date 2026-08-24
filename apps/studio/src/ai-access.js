export const AI_ACCESS_MODES = Object.freeze({
  READ: 'read',
  WRITE: 'write',
  FULL: 'full',
});

export function aiAccessFlags(mode) {
  const allowWrites = mode === AI_ACCESS_MODES.WRITE || mode === AI_ACCESS_MODES.FULL;
  return {
    allowWrites,
    allowDeletes: allowWrites && mode === AI_ACCESS_MODES.FULL,
  };
}
