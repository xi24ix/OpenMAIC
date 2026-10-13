import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';

describe('DEFAULT_BRAND (single-brand build)', () => {
  it('uses the Alostad identity for full chrome', () => {
    expect(DEFAULT_BRAND.productName).toBe('Alostad');
    expect(DEFAULT_BRAND.shortName).toBe('Alostad');
    expect(DEFAULT_BRAND.markSrc).toBe('/alostad-mark.svg');
    expect(DEFAULT_BRAND.themeColor).toBe('#2f3b96');
  });

  it('marks its horizontal logo as already containing the wordmark', () => {
    expect(DEFAULT_BRAND.logoHasWordmark).toBe(true);
    expect(DEFAULT_BRAND.logoSrc).toBe('/alostad-logo.svg');
  });
});
