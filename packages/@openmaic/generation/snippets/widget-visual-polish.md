## Visual Quality Standard for ALL Interactive Widgets (shared)

A widget that "works" but looks like a 2005 dashboard fails this pipeline as much as a widget that crashes. Apply the course design directive (see "Design Directive" in the user prompt) to every widget.

### Palette discipline

- Use those exact colors from the design directive for: page/canvas background, primary accents, text, and semantic states. Do not invent new hues per element.
- One background treatment across all views; one accent hue doing the highlighting. 60% neutral / 30% secondary / 10% accent, never the accent everywhere.
- Text contrast: body text ≥ 4.5:1 against its actual background (count tint overlays). Never light text on mid-tone backgrounds. If uncertain, darken the surface, not the text.
- On dark surfaces, never full-screen linear gradients (they band); use a solid base + one or two radial gradient glows at 12–25% opacity. Tint neutrals (like #1a1f2e, #e8ecf4) toward the accent hue — dead pure grays look undesigned.

### Layout & depth

- Largest-to-smallest hierarchy is visible in 2 seconds: one hero element (number, headline, chart) per view; labels < 16px only for metadata.
- Cards use 12–20px radii, 2–4px borders or soft shadows — web UI values are invisible at classroom projection distance, so scale up: body text ≥ 16px on mobile-safe layouts, ≥ 20px on main surfaces, padding ≥ 24px between zones.
- Every scene (state) needs at least two focal points the eye can travel between — a single floating text block is a failure.
- Backgrounds are never empty: add 2–5 subtle decorative layers (accent-tinted radial glow, oversized faded keyword at 3–8% opacity, hairline grid, muted panel) so whitespace looks intentional.
- Icons: use inline SVG (project/stroke style, 2px round-cap strokes, viewBox 0 0 24 24). No emoji as primary info — emoji only inside achievement/reward badges.

### Motion has meaning

- Decorative elements get one ambient animation (breathing glow, slow drift, gentle rotation) so nothing reads static; shared across them is fine.
- State changes animate ~200–300ms `ease-out` (entrances), `ease-in` (exits); reveal beats stagger children 50–120ms apart. Springs for direct manipulation only.
- Numbers count up to their value (~0.8–1.2s, `power2.out`) when they enter; progress bars/donuts draw when revealed, not before.
- No animation is longer than 600ms except cinematic reveals the directive's motionPersonality explicitly asks for. "The best motion is barely noticeable."
- All motion must be deterministic: no `Date.now()` state in published observations, no unseeded randomness inside rendered results. Randomness is allowed only for generated practice content, and then through a seeded helper.

### States, feedback & safety

- Every control gives feedback within 100ms (hover/active/pressed/disabled states defined in CSS).
- Loading/empty/error states exist and use the same palette (spinner or skeleton bars, not invented colors).
- Failure feedback is supporting, never guilt-tripping: green = correct/done, amber = check again, red = unsafe/wrong.
- Mobile safety: 44px min touch targets, collapsible panels, no horizontal scroll, canvas resizes with container.

### Hand-drawn (doodle) vocabulary — a coherent alternative when the subject calls for it

When the design directive's concept or the topic suits a hand-drawn feel (history, storytelling, human/animal subjects, processes "drawn" for the learner), a doodle system is a first-class style — but it is a SYSTEM, not an excuse for sloppiness:

- Flat single-color fills + bold 3–4px near-black outlines on every shape; simple geometric forms, oversized and simplified. ZERO gradients, ZERO shadows, ZERO textures — flatness is the style's identity, and mixing glossy + doodle is a failure.
- People are bold stick figures with large round heads, dot eyes, thick expressive brows; color-coding carries state (red = heat/embarrassment, white = neutral).
- Backgrounds are single flat color blocks: white default; a green floor strip = ground; blue sky + green ground = outdoors; orange = sunset/fire/old; blue = underwater; beige = desert/cave.
- On-screen keywords in a wide marker-style weight, top-of-frame, red/black/yellow only; diagonal arrows (black or yellow) point AT things with a short capital label beside the arrowhead; thought bubbles are classic clouds with 1–2 words inside.
- Motion matches the marker metaphor: strokes draw in (`strokeDashoffset`), elements pop with slight wobble-then-settle (a small `back.out`), never smooth cinematic eases.

### On-screen Arabic & RTL text (all widgets)

- Strip diacritics (tashkeel) and tatweel (ـ) from rendered on-screen words; keep `؟`/`!` only as the final mark of a phrase.
- Western digits `0–9` by default; each number in its own short group.
- RTL reveals run right-to-left; copy the course's own spelling letter-for-letter — never normalize, translate or "fix" the teaching language's words on screen.
