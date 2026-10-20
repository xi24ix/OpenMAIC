'use client';

import { cn } from '@/lib/utils';

/**
 * The Alostad brand mark: a coral four-point spark above an open book.
 * Colours ride the logo CSS custom properties (`--logo-ink`, `--logo-accent`,
 * `--logo-paper` — see `app/globals.css`) so dark mode can lift the ink while
 * keeping the coral spark constant.
 */
export function AlostadMark({ className, ...rest }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path
        d="M32 5 L35.9 19.8 L50.5 23.7 L35.9 27.6 L32 42.4 L28.1 27.6 L13.5 23.7 L28.1 19.8 Z"
        fill="var(--logo-accent, #e46455)"
      />
      <path
        d="M6.5 39.5 C 16.5 34.5, 26.5 36, 32 43.5 C 37.5 36, 47.5 34.5, 57.5 39.5 L 57.5 50 C 47.5 45, 37.5 46.5, 32 54 C 26.5 46.5, 16.5 45, 6.5 50 Z"
        fill="var(--logo-ink, #1b2140)"
      />
      <path
        d="M32 43.5 V 54"
        stroke="var(--logo-paper, #fff)"
        strokeWidth="1.2"
        opacity=".28"
      />
    </svg>
  );
}

/**
 * One knob for the lockup: each preset pairs the root HEIGHT with the
 * wordmark FONT-SIZE, because the mark is sized off the height while the
 * Arabic/Latin lockup is sized off the font-size (Cairo sets Arabic glyphs
 * at roughly 0.8× the em, so the two numbers are tuned per size to keep the
 * wordmark optically balanced against the mark).
 */
const LOGO_SIZES = {
  /** Compact header rows (workspace home, mobile chrome). */
  sm: { height: 'h-5', text: 'text-[12px]' },
  /** Sidebar / rail headers. */
  md: { height: 'h-6', text: 'text-[15px]' },
  /** Pro nav rail home link. */
  rail: { height: 'h-[21px]', text: 'text-[13px]' },
  /** Access-code gate card. */
  gate: { height: 'h-8', text: 'text-[24px]' },
  /** Classic home hero. */
  hero: { height: 'h-12 md:h-16', text: 'text-[34px] md:text-[44px]' },
  /** Pro workspace hero (`.ws-hero-logo` is 46/56px). */
  pro: { height: 'ws-hero-logo', text: 'text-[34px] md:text-[42px]' },
} as const;

export interface AlostadLogoProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Size preset — pairs the lockup height with the wordmark font-size. */
  size?: keyof typeof LOGO_SIZES;
  /** Mark-only lockup (rare; the wordmark is the default). */
  showWordmark?: boolean;
}

/**
 * The horizontal Alostad lockup: spark-and-book mark + Arabic wordmark with
 * the Latin brand line beneath it, the way the brand is drawn in the UI.
 */
export function AlostadLogo({
  size = 'md',
  showWordmark = true,
  className,
  ...rest
}: AlostadLogoProps) {
  const preset = LOGO_SIZES[size];

  return (
    <span
      role="img"
      aria-label="Alostad"
      className={cn('inline-flex shrink-0 items-center gap-2', preset.height, className)}
      {...rest}
    >
      <AlostadMark className="aurora-logo-mark h-full w-auto shrink-0" />
      {showWordmark && (
        <span className={cn('flex flex-col items-start gap-[0.12em] leading-none', preset.text)}>
          <span
            className="leading-none font-black"
            style={{ color: 'var(--logo-ink, #1b2140)' }}
          >
            الأستاذ
          </span>
          <span
            className="w-full text-center font-extrabold opacity-60"
            style={{
              fontSize: '0.34em',
              letterSpacing: '0.22em',
            }}
          >
            ALOSTAD
          </span>
        </span>
      )}
    </span>
  );
}
