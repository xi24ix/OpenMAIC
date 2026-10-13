export type LocaleEntry = {
  code: string;
  /** Native name shown in dropdown, e.g. 'العربية' */
  label: string;
  /** Short label shown on the toggle button, e.g. 'AR' */
  shortLabel: string;
};

/**
 * Supported locales registry.
 *
 * Alostad is Arabic-first: `ar-SA` is the product default and `en-US` is the
 * only other language the switcher offers. The remaining locale JSONs from the
 * upstream OpenMAIC tree still exist on disk for tests that read them, but
 * they are unreachable at runtime — `i18next`'s `supportedLngs` (see `config.ts`)
 * is derived from this list.
 *
 * To add a new language:
 *   1. Create `lib/i18n/locales/<code>.json` (copy an existing file as template)
 *   2. Add an entry here
 */
export const supportedLocales = [
  { code: 'ar-SA', label: 'العربية', shortLabel: 'AR' },
  { code: 'en-US', label: 'English', shortLabel: 'EN' },
] as const satisfies readonly LocaleEntry[];
