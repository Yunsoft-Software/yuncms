import { useCallback } from 'react';

import { useStudioSettings } from './contexts/StudioSettingsContext.jsx';
import { translate } from './localization.js';

export function useI18n() {
  const { locale, setLocale, useDefaultLocale } = useStudioSettings();
  const t = useCallback((key, values) => translate(locale, key, values), [locale]);
  return { locale, setLocale, useDefaultLocale, t };
}
