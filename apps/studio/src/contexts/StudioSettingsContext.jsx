import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import {
  DEFAULT_STUDIO_SETTINGS,
  applyStudioAppearance,
  normalizeStudioSettings,
  readLocalePreference,
  writeLocalePreference,
} from '../studio-settings.js';

const StudioSettingsContext = createContext(null);

function prefersDarkMode() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

export function StudioSettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_STUDIO_SETTINGS);
  const [localeOverride, setLocaleOverride] = useState(() => readLocalePreference());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const applySettings = useCallback((nextSettings) => {
    const normalized = normalizeStudioSettings(nextSettings);
    setSettings(normalized);
    applyStudioAppearance(normalized, prefersDarkMode());
    return normalized;
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiRequest('/studio-settings', {}, { retryAuth: false })
      .then((response) => {
        if (!cancelled) applySettings(response?.data ?? DEFAULT_STUDIO_SETTINGS);
      })
      .catch((error) => {
        if (!cancelled) {
          applySettings(DEFAULT_STUDIO_SETTINGS);
          setLoadError(error?.message || 'Studio settings could not be loaded');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [applySettings]);

  useEffect(() => {
    if (settings.theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyStudioAppearance(settings, media.matches);
    media.addEventListener?.('change', handleChange);
    return () => media.removeEventListener?.('change', handleChange);
  }, [settings]);

  const locale = localeOverride || settings.default_locale;

  const setLocale = useCallback((nextLocale) => {
    writeLocalePreference(nextLocale);
    setLocaleOverride(nextLocale);
  }, []);

  const useDefaultLocale = useCallback(() => {
    writeLocalePreference(null);
    setLocaleOverride(null);
  }, []);

  const saveSettings = useCallback(async (patch) => {
    const response = await apiRequest('/studio-settings', {
      method: 'PATCH',
      body: patch,
    });
    return applySettings(response?.data ?? settings);
  }, [applySettings, settings]);

  const value = useMemo(() => ({
    settings,
    locale,
    localeOverride,
    loading,
    loadError,
    setLocale,
    useDefaultLocale,
    saveSettings,
  }), [
    settings,
    locale,
    localeOverride,
    loading,
    loadError,
    setLocale,
    useDefaultLocale,
    saveSettings,
  ]);

  return (
    <StudioSettingsContext.Provider value={value}>
      {children}
    </StudioSettingsContext.Provider>
  );
}

export function useStudioSettings() {
  const context = useContext(StudioSettingsContext);
  if (!context) throw new Error('useStudioSettings must be used inside StudioSettingsProvider');
  return context;
}
