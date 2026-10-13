# DESIGN.md — Alostad visual system

## Palette (lifted from the logo)

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--primary` | `#2f3b96` (navy) | `#7d87e6` | buttons, focus, active states |
| `--brand-ink` | `#2f3b96` | `#aab2f2` | logo figure + wordmark, brand text |
| `--brand-coral` | `#f4796b` | `#f79384` | the play button, warm accents, hero glow |

The upstream purple (`#722ed1`) is retired as the primary. Violet utility
highlights still scattered through the codebase (e.g. `bg-purple-50` state
pills) are tolerated as secondary chrome, not brand.

## Typography

- **Cairo** is the Arabic + brand face — modern, geometric, self-hosted from
  `public/fonts/cairo` (fontsource woff2, OFL, `unicode-range`-subsetted).
  Weights 400/500/600/700/800/900 (Arabic) + 400/900 (Latin).
- **Inter** keeps the Latin UI (it sits first in `--font-sans`: `'Inter
  Variable', 'Cairo', …`), so only Arabic glyphs and the Latin wordmark fall to
  Cairo.
- Root size: `16px` for `html:lang(en)`, **`18px` for `html:lang(ar)`** —
  Arabic copy gets the bigger, more legible scale. `I18nProvider` keeps
  `<html lang>` in step with the locale.
- Never apply negative tracking to Arabic text.

## Logo

`components/brand/alostad-logo.tsx`:

- `AlostadMark` — inline SVG: navy head + open book + rounded coral play
  triangle (recreated from the original logo; colors ride `--brand-ink` /
  `--brand-coral` so dark mode lifts them).
- `AlostadLogo` — mark + wordmark, wordmark localized (`أستاذ` / `Alostad`),
  sized through **presets that pair root height with wordmark font-size**:
  `sm` (20px headers), `md` (24px sidebars), `rail` (21px pro nav), `gate`
  (32px access modal), `hero` (48/64px classic home), `pro` (46/56px
  `.ws-hero-logo`).
- Static twins for `<img>`/direct-URL consumers: `public/alostad-mark.svg`,
  `public/alostad-logo.svg`. Legacy `public/logo-horizontal.png` and
  `public/openmaic-mark.png` remain only because tests/export fixtures pin
  them.

## Motion & surfaces

- Home hero keeps its single authored entrance (`heroEnter` stagger); hero
  ambient glows are brand-tinted (`#2f3b96` at 12%, `#f4796b` at 12%).
- The access-code gate card keeps its mesh-gradient backdrop, re-keyed to
  `--primary` / `--brand-coral` / `--brand-ink`.
