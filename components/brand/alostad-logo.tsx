'use client';

import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';

/**
 * The Alostad brand mark, recreated as vector geometry from the original
 * logo: a navy reader (head above an open book) with the coral play button
 * at its centre. Colours ride the brand CSS custom properties (`--brand-ink`,
 * `--brand-coral` — see `app/globals.css`) so dark mode can lift the navy for
 * contrast while staying inside the logo's palette.
 */
export function AlostadMark({ className, ...rest }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 96 96"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {/* Reader's head */}
      <circle cx="46" cy="16" r="11.5" fill="var(--brand-ink)" />
      {/* Right page of the open book, sweeping up behind the play button.
          Ends slightly past the spine (x=44) so it tucks under the left page
          with no antialiasing seam down the middle. */}
      <path
        d="M46 41 C 62 47 80 41 91 26 C 96 52 82 82 44 89 Z"
        fill="var(--brand-ink)"
        stroke="var(--brand-ink)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* Left page */}
      <path
        d="M46 45 C 33 51 15 47 5 36 C 1 61 17 84 46 89 Z"
        fill="var(--brand-ink)"
        stroke="var(--brand-ink)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* Coral play button, rounded via an equal-colour stroke */}
      <path
        d="M39 51 L 63 62 L 39 73 Z"
        fill="var(--brand-coral)"
        stroke="var(--brand-coral)"
        strokeWidth="7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * One knob for the lockup: each preset pairs the root HEIGHT with the
 * wordmark FONT-SIZE, because the mark is sized off the height while the
 * Arabic/Latin wordmark is sized off the font-size (Cairo sets Arabic glyphs
 * at roughly 0.8× the em, so the two numbers are tuned per size to keep the
 * wordmark optically balanced against the mark).
 */
const LOGO_SIZES = {
  /** Compact header rows (workspace home, mobile chrome). */
  sm: { height: 'h-5', text: 'text-[14px]' },
  /** Sidebar / rail headers. */
  md: { height: 'h-6', text: 'text-[17px]' },
  /** Pro nav rail home link (matches the old 21px lockup). */
  rail: { height: 'h-[21px]', text: 'text-[15px]' },
  /** Access-code gate card. */
  gate: { height: 'h-8', text: 'text-[27px]' },
  /** Classic home hero (was a 48/64px PNG). */
  hero: { height: 'h-12 md:h-16', text: 'text-[42px] md:text-[54px]' },
  /** Pro workspace hero (`.ws-hero-logo` is 46/56px). */
  pro: { height: 'ws-hero-logo', text: 'text-[38px] md:text-[46px]' },
} as const;

export interface AlostadLogoProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Size preset — pairs the lockup height with the wordmark font-size. */
  size?: keyof typeof LOGO_SIZES;
  /** Mark-only lockup (rare; the wordmark is the default). */
  showWordmark?: boolean;
}

/**
 * The horizontal Alostad lockup: brand mark + wordmark. The wordmark speaks
 * the active UI language — `أستاذ` under Arabic, `Alostad` under English —
 * while the mark stays constant, the way a bilingual brand mark should.
 */
export function AlostadLogo({
  size = 'md',
  showWordmark = true,
  className,
  ...rest
}: AlostadLogoProps) {
  const { locale } = useI18n();
  const preset = LOGO_SIZES[size];
  const isArabic = locale === 'ar-SA';

  return (
    <span
      role="img"
      aria-label="Alostad"
      className={cn(
        'inline-flex shrink-0 items-center gap-2',
        preset.height,
        preset.text,
        className,
      )}
      {...rest}
    >
      <AlostadMark className="h-full w-auto shrink-0" />
      {showWordmark && (
        <span
          className={cn('leading-none font-black', !isArabic && 'tracking-tight')}
          style={{ color: 'var(--brand-ink)' }}
        >
          {isArabic ? 'أستاذ' : 'Alostad'}
        </span>
      )}
    </span>
  );
}