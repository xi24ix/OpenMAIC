# Alostad Classroom — Twilight Voxel World 🌆⛏️

The **alive** implementation of the `Twilight Voxel Classroom` reference mock:
an RTL Arabic educational landing page set in a Minecraft-style voxel twilight
world. The background is now a **looping cinematic day→night video**
(`alostad-backgroung.mp4` recompressed 25MB→5.9MB/2.2MB with a seamless
crossfaded loop) rendered as a three.js `VideoTexture`, with an interactive
particle layer on top and a **live ranking list** (leaderboard) below the hero.

> Concept origin: the ChatGPT session "Design Minecraft Learning UI" — AAA
> Minecraft-style UI, background generated *separate* from UI elements, then
> made alive with code (three.js + GSAP). v2 swaps the still plate for the
> looping video and perfects the responsive layout across desktop / iPad /
> mobile.

## Run

```bash
python3 -m http.server 4747
# open http://127.0.0.1:4747
```

## What makes it alive

| Layer | Effect |
|---|---|
| Video | Looping day→night cinematic (`VideoTexture` on the world plane; still WebP plate shows first + acts as fallback; 720p variant auto-selected ≤820px) |
| Phase sync | `body.phase-night` class follows the video's dark half → deeper night grade crossfades in (2.5s) |
| Camera | Mouse parallax + slow idle drift (depth = natural parallax per layer) |
| Sky | Shooting stars with gradient trails through the upper sky band |
| Magic | 9 floating/bobbing glowing cubes over the scene |
| Sparks | Gold fireflies at the lanterns/platform + purple plume at the portal + castle sparkles (custom shader points, additive) |
| Mist | Two slow drifting fog sprites along the foreground |
| Click | Voxel-burst particle explosion at cursor (pooled) |
| Torch | A soft warm light glow follows the mouse (CSS blend layer) |

*(The voxel explorer + cat are part of the video itself now — the three.js
character layer was retired when the video background shipped.)*

## Responsive

Four tuned breakpoints: desktop ≥1100, iPad landscape ≤1100, iPad portrait
≤900 (2×2 feature grid, stacked podium, 420px centered rank column with delta
chips, matched ticker width), phones ≤600 (compact topbar, wrapped chips,
full-width CTA, stacked footer) + a short-landscape rule for sideways phones.
Feature text wraps gracefully at every size — nothing clips or touches.

## The ranking list (leaderboard)

- Crowned podium (top-3) + rows 4–8 with **deterministic pixel-art avatars** generated from name seeds.
- Live online-learner counter, XP ticks with bar growth, and **bubble-up rank swaps** (a row only moves up when its XP genuinely overtakes the row above — the board always stays honest), FLIP-animated with GSAP.
- LIVE activity ticker (centered feed) rotating learner achievements.
- Reveal-on-scroll via ScrollTrigger; XP bars fill when they enter the viewport.

## Stack

- **three.js r128** (vendored) — one perspective camera at z=100; the background
  plate is a textured plane so every particle/character anchor maps to
  image-normalized coordinates (`imgToWorld`) and stays glued to world features.
- **GSAP 3 + ScrollTrigger** (from the repo's node_modules) — intro timeline,
  typing rotator, ticker, FLIP swaps, scroll reveals.
- **Baloo Bhaijaan 2** (Arabic + Latin, rounded) and **Silkscreen** (pixel) —
  self-hosted woff2.
- No build step. Pure static files.

## Files

```
index.html          markup (RTL, Arabic, shared SVG gradients)
assets/style.css    glass system, Minecraft bevels, grades, leaderboard
assets/app.js       three.js world + all UI life (~700 lines)
assets/bg-plate.webp / .png  clean UI-free background plate (webp primary)
assets/reference-mock.png  the approved mock for comparison
shots/              review screenshots + motion videos (judge loop evidence)
tools/shoot.js      playwright-core screenshot capture (headless chromium)
tools/record.js     full-journey video recorder
tools/record-hero.js  hero-only video recorder (shooting-star evidence)
tools/debug.js      DOM state probe used while debugging the ticker
vendor/             three.min.js, gsap.min.js, ScrollTrigger.min.js
```

## Review loop (v1 — image background)

| Round | Score | Key fixes |
|---|---|---|
| 1 | 8/10 | scroll-hint collision, featureless cat, small RTL text, headline highlight phrase, backpack missing, ticker centering, star cadence, cool hue |
| 2 | **9/10 PASS** | cat rebuilt, all round-1 fixes verified |

## Review loop (v2 — video background, responsive)

An international UI/UX judge scored the video build across all four viewports:

| Round | Score | Key fixes |
|---|---|---|
| 1 | 8.5/10 | ticker emoji tofu, footer Arabic tracking, mobile chip-row balance, scroll-indicator air, iPad width rhythm, honest XP scale, phase contrast + CTA scrim |
| 2 | **9/10 PASS** | all seven verified fixed; "submit-as-is quality" |
| 2b | polish | typewriter never blank (solid caret while empty), stacked mobile footer, tablet delta chips restored, ticker width matched to the 420px column |

## Motion evidence

- `shots/demo.webm` — 35s full journey: intro → alive hero → scroll to the
  leaderboard → live XP ticks, bubble-up rank swap, ticker rotation.
- `shots/hero-stars.webm` — 18s hero clip; shooting stars streak through the
  sky band (see contact sheets `sheet-stars.png`, `sheet-board.png`).

## Performance

- Background plate shipped as **WebP (351 KB, q90)** with PNG fallback for
  engines without WebP — 85% smaller than the original PNG.
- DPR capped at 1.75, RAF paused when tab hidden, pooled particles,
  `powerPreference: high-performance`, single draw call for clouds (InstancedMesh).

Accessibility: `prefers-reduced-motion` respected (static render + no
parallax), all controls keyboard-focusable, decorative canvas `aria-hidden`.


## App integration (v3 — live in the app, Minecraft default)

The style shipped into the real app (`app.zobeidi.com` build):

| Piece | File |
|---|---|
| Style provider (`'aurora' \| 'voxel'`, localStorage, pre-paint) | `lib/hooks/use-style-theme.tsx` + `app/layout.tsx` |
| Voxel world React component (video texture, particles, cleanup-safe) | `components/voxel/voxel-world.tsx` |
| Theme layer (token remap on `body:has(.voxel-page)` so Radix portals follow, aurora overrides) | `app/voxel.css` |
| Header switcher + world mount | `app/page.tsx` |
| Generation flow consistency | `app/generation-preview/page.tsx` |
| Assets (loop video 1080/720, plate webp, fonts) | `public/voxel/` |

- **Minecraft is the default** (`DEFAULT_STYLE_THEME`); Aurora remains selectable and pixel-identical after a full round trip (frozen-animation diff proof: `shots/app-integration/diff-aurora.png`).
- World layers sit at negative z (canvas −2, grades −1) so **any** host page content paints above them without z tuning.
- Verified end-to-end on the Docker deployment (`docker compose build openmaic && docker compose up -d`): default style, all homepage popovers, persistence, generation flow, Aurora restore — `shots/app-integration/`.
- Judge loop: 8 → **9/10 PASS** (zero blocking issues).

Tool note: `tools/verify-app.js` and `tools/record*.js` need a Playwright
headless shell in `~/.cache/ms-playwright` (removed after the session's
cleanup — reinstall with `npx playwright install chromium-headless-shell` if
re-running them).
