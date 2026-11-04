import { useEffect, useRef } from 'react';
import { useConfirmDialog } from './components/index.js';
import { useI18n } from './i18n.js';
const guards = new Set();
let confirmation = null;
export function confirmStudioNavigation() {
  if (!confirmation) confirmation = (async () => {
    for (const guard of [...guards]) if (!await guard()) return false;
    return true;
  })().finally(() => { confirmation = null; });
  return confirmation;
}
export function useUnsavedChanges(dirty) {
  const confirmAction = useConfirmDialog(), { t } = useI18n(), dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const latest = useRef(null);
  latest.current = async () => !dirtyRef.current || await confirmAction({ title: t('features.unsaved'), description: t('features.discard') });
  useEffect(() => {
    const guard = () => latest.current();
    guards.add(guard);
    return () => { guards.delete(guard); };
  }, []);
  return { confirmDiscard: () => latest.current(), clear: () => { dirtyRef.current = false; } };
}
