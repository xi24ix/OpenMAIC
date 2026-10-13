'use client';

import { createContext, useContext, useEffect, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type Locale, defaultLocale, supportedLocales } from '@/lib/i18n';
import '@/lib/i18n/config';

const LOCALE_STORAGE_KEY = 'locale';

/** Match a browser language code (e.g. 'en', 'zh-TW') to a supported locale */
function resolveLocale(lang: string): Locale {
  // Exact match
  const exact = supportedLocales.find((l) => l.code === lang);
  if (exact) return exact.code;
  // Prefix match: 'en' → 'en-US', 'zh' → 'zh-CN'
  const prefix = lang.split('-')[0].toLowerCase();
  const match = supportedLocales.find((l) => l.code.toLowerCase().startsWith(prefix));
  return match?.code ?? defaultLocale;
}

type I18nContextType = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
};

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();

  const locale = (i18n.language || defaultLocale) as Locale;

  // Honor an explicit earlier choice (after hydration, to avoid an SSR
  // mismatch). Without a stored choice the platform stays on its Arabic
  // default — we deliberately do NOT sniff `navigator.language` any more,
  // since Arabic is the product's default and English is opt-in via the
  // language switcher.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (!stored) return;
      const target = resolveLocale(stored);
      // A stored code from before a locale was retired (e.g. 'zh-CN') resolves
      // to the default — persist the resolution so we stop re-resolving it.
      if (target !== stored) localStorage.setItem(LOCALE_STORAGE_KEY, target);
      if (target !== i18n.language) i18n.changeLanguage(target);
    } catch {
      // localStorage unavailable, keep default
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep `<html lang>` truthful for CSS (`html:lang(ar)` sizing) and a11y.
  // The server renders `lang="ar"` to match the default locale.
  useEffect(() => {
    if (document.documentElement.lang !== locale) {
      document.documentElement.lang = locale;
    }
    // Arabic-first: the document direction follows the UI language (ar → rtl,
    // en → ltr) so Arabic copy, form layouts and flex flow render correctly
    // in the default locale and flip back when the user opts into English.
    // The server renders `dir="rtl"` to match the default locale.
    const dir = locale.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr';
    if (document.documentElement.dir !== dir) {
      document.documentElement.dir = dir;
    }
  }, [locale]);

  const setLocale = (newLocale: Locale) => {
    i18n.changeLanguage(newLocale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
    } catch {
      // localStorage unavailable
    }
  };

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
