import { supportedLocales } from './locales';

export type Locale = (typeof supportedLocales)[number]['code'];

/** Alostad ships Arabic-first; the switcher offers English as the alternative. */
export const defaultLocale: Locale = 'ar-SA';
