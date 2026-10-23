# Motion-Graphic Explainer Generator (Course Intro "Trailer")

Generate a self-contained HTML motion-graphic explainer — a cinematic, animated opening scene for an online course, in the style of premium product-launch motion graphics (kinetic typography, hero stats, icon choreography, SVG path draws).

**This is the FIRST scene of the course: its job is to HOOK the learner in 20–45 seconds and make them want to continue.** Motion is the message; there is no narrator audio inside the widget — the teacher (outside the iframe) narrates over it.

## Story Shape (4 phases — follow exactly)

Build ONE master timeline with 4 labeled phases. Each phase is one idea. Total on-screen duration 25–45 s:

| Phase | Label | Duration | Job |
|---|---|---|---|
| 1. HOOK | `p0` | 6–10 s | Open with the question, paradox, or stakes of the topic. A *wait, what?* moment — never "Welcome to course X". One bold statement, a moving visual, an intriguing number. |
| 2. TEASE | `p1` | 7–12 s | Sketch the territory the course covers: 3–4 keyword cards or icons snap/chase in, a comparison or a map of the problem space. Sets expectation, not detail. |
| 3. SPARK | `p2` | 8–14 s | The signature visual moment: one idea animated beautifully — the concept as a moving infographic (orbit, build-up, transformation, count-up, path draw). This is the beat people remember. |
| 4. TITLE | `p3` | 5–8 s | Course title lockup: assemble/inch to final position, then everything settles into a calm LOOPING ambient state (breathing glow, drifting particles) for as long as the scene stays open. |

**Content rules (NON-NEGOTIABLE):**
- Ground EVERYTHING in the topic from Scene Information. Real keywords, real numbers (mark hypothetical ones as "example"), real terminology in the course language.
- Max ~2-8 words per card; readable in 1.5 s. The learner reads while the teacher speaks.
- No fake claims about the course ("best course ever", fake student counts). No teacher identity. Captions in the teaching language (per `languageDirective`) — including proper names kept in their original script.
- No photographic assets, no external images (except CDNs listed below). Everything is CSS/SVG/typography. This keeps generation cheap and offline-safe.

## Master Design Skill (motion doctrine — read carefully)

### Easing is emotion, not technique

- `.out` eases for entrances (starts fast, decelerates — confident). `.in` for exits. `.inOut` for repositioning. Sine for ambient loops. **Linear only for rotation, ticks, progress** — never for spatial movement.
- Durations: micro (0.15–0.3s) = energy; standard (0.3–0.5s) = professional; slow (0.5–0.8s) = gravity; very slow (0.8–1.6s) = cinematic. Vary: the slowest tween in a phase should be ≥ 3× the fastest. Never default everything to one duration.
- Exits are 30–50% FASTER than entrances. Overshoot-and-settle (`back.out(1.4)`) for playful entries; `expo.out` for confident reveals; `elastic.out(1, 0.5)` sparingly.

### Choreography

- Stagger children 60–140ms apart; keep a whole stagger sequence under 500ms. The element that moves FIRST reads as most important — lead with the hero.
- One ambient motion per phase (breathing glow, slow drift, subtle scale) — attached to the seekable timeline, never a bare `gsap.to()` outside it.
- Vary entrance directions across elements (from left / from right / scale-up / blur-in / letter-spacing). Repeating `y:30 + fade` for everything is a failure.
- Scene structure per phase: **build** (elements enter, first 30%) → **breathe** (hold, ambient alive, middle 40%) → **resolve** (exit or hand off, last 30%). No dead air, no abrupt stops.
- Never run two independent tweens on the SAME element+property concurrently; if one element needs an entrance AND a continuous motion, combine in a single `fromTo()` or nest (parent gets entrance, child gets the loop).
- Prefer `tl.fromTo()` over `tl.from()` — deterministic under phase seeking.

### Kinetic typography (main technique toolbox)

| Effect | How |
|---|---|
| Sequential word reveal | Words pop one-by-one, 80–150ms apart, slight overshoot |
| Expressive scale | The KEY word jumps to 130–160% scale + accent color, others dim |
| Typewriter / mask reveal | Clip-path inset or width reveal left→right |
| Gradient-text sweep | Shimmering gradient across large headline (sparingly) |
| Letter-spacing settle | Wide tracking → tight tracking as word lands |
| 3D flip / rotate entrance | `rotationX/Y` with `transformPerspective: 1200` |
| Path draw | SVG `strokeDashoffset` to 0 over 0.6–1.2s (logos, arrows, connectors) |
| Count-up | Number for 0→target, ~1s, `power2.out`, snap:true integers |
| Progress bar / donut fill | scaleX or stroke draw when revealed |

### Composition (frames are scenes, not web pages)

- Fill the stage: hero text spans 60–80% of width, entrance padding 60–140px.
- ≥ 2 focal points per phase so the eye travels; anchor content to edges or split into zones — not everything centered-floating.
- ≥ 3 layers per phase: background treatment (radial accent glow, oversized ghost word at 3–8% opacity, subtle grid/panel) + midground content + foreground accents (hairline rules that `scaleX` from 0, index labels, tick marks).
- Scale: headlines 56–120px (weight 700–900, tight tracking); key words 34–48px; labels 16–22px; borders 2–4px; decorative opacity 12–25%. Use `clamp()` and `vw/vmin` units so it scales inside any iframe size.

## Design Directive

The Scene Information contains a **Design Directive** (palette, mood, motion personality). It is LAW:

- Background is the directive's `background` mode (dark builds feel cinematic; light builds need bold 2px+ structural elements and full-saturation accent hits to avoid the blank-slide feel).
- Use the directive's `palette` hexes only. Map: `palette[0]` → base/background or the darkest neutral, then text/high-contrast neutrals stay within ±10 lightness of the palette's neutrals; the accent (brightest/most saturated) is the 10% — HOOK keyword, hero number, draw strokes, glow.
- `motionPersonality` sets the tween voice: `playful` → overshoot/elastic, 20–30% exaggeration; `premium` → slow calm eases, zero overshoot, generous whitespace; `energetic` → fast cuts, hard snaps, high stagger; `calm` → long holds, gentle sine ambient; `storytelling` → front-load the SPARK phase.
- If the directive is missing or incomplete, choose ONE coherent system yourself (declare bg / text / accent before writing CSS), and keep it across every phase.

**Do NOT:** gradient text everywhere, cyan-on-dark cliché, neon-on-neon, pure `#000`/`#fff`, identical repeated cards, more than one gradient text effect per phase. Tint neutrals toward the palette.

## Technical Contract (MANDATORY)

### 1. Deterministic timeline

```html
<!DOCTYPE html>
<html>
<head>
  <!-- GSAP via CDN (same allowance as 3D widgets) -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <style> /* all custom CSS inline, fonts = system stacks only */ </style>
</head>
<body>
  <div id="experiment"> <!-- the whole scene inside this wrapper -->
    ...
    <script type="application/json" id="widget-config"> ... </script>
    <script> /* all JS */ </script>
  </div>
</body>
</html>
```

- ONE master timeline: `const tl = gsap.timeline({ paused: false })` with **labels `p0`…`p3`** at each phase boundary.
- Total active timeline ~25–45 s. After the TITLE phase, append a repeating ambient block: `tl.to(..., { ..., repeat: -1 }, 'amb')` is FORBIDDEN on the master (it would stall phase seeking) — instead build a separate `ambientTl = gsap.timeline({ paused: true, repeat: -1 })` and start it when the master completes (`tl.eventCallback('onComplete', () => ambientTl.play())`). Ambient changes nothing that phases depend on.
- **No `Date.now()` for animation state, no `Math.random()` inside the timeline** (seeded jitter in decorative particles is allowed: `gsap.utils.random` with a fixed seed or precomputed offsets). Everything visible must be a pure function of timeline position so Replay and phase-seek are exact.
- Fallback without network: wrap usage — if `typeof gsap === 'undefined'`, add class `no-anim` to `<body>`. CSS: `.no-anim [data-step]{opacity:1;transform:none}` and skip timeline creation. Content must be fully readable, statically laid out, with the HTML static fallback (a static poster) — never a blank iframe.
- No audio, no video tags, no fetch(), no localStorage, no timers/runnning loops outside the timelines.

### 2. Phase control API (REQUIRED)

Single-script discipline: ALL widget JavaScript lives in exactly ONE top-level `<script>` —
timelines (`tl`, `ambientTl`), phase state (e.g. `phaseIndex`), the publish helper, the phase API
and the message router. No second block, no DOMContentLoaded closure, no cross-block references
(a variable used by one block must be declared in that same block — cross-block and closure
references throw `X is not defined` and brick the phase loop). `setExplainerPhase` must never
throw for `'p0'..'p3'`, a number or `undefined`, and must always update state + re-publish even
when a seek is a no-op.

Skeleton — keep this structure in one script:

```javascript
<script>
  const tl = gsap.timeline({ paused: false });            // labels p0..p3
  const ambientTl = gsap.timeline({ paused: true, repeat: -1 });
  let phaseIndex = 0;                                       // one source of truth

  function publishCurrentState() {
    publish({ summary: `Phase ${phaseIndex + 1}`, state: { phase: 'p' + phaseIndex, phaseIndex } });
  }

  window.setExplainerPhase = function (phase) {           // never throws
    const p = typeof phase === 'number' ? 'p' + phase
            : ['p0', 'p1', 'p2', 'p3'].includes(String(phase)) ? String(phase) : null;
    if (!p) { tl.restart(); return publishCurrentState(); }
    ambientTl.pause();
    tl.seek(p, false); tl.play();
    phaseIndex = Number(p.slice(1));
    document.querySelectorAll('.phase-dot').forEach(function (d, i) {
      d.classList.toggle('active', i === phaseIndex);
    });
    publishCurrentState();
  };

  window.explainerGetState = function () {
    return { phase: 'p' + phaseIndex, progress: tl.totalProgress() };
  };

  window.addEventListener('message', function (event) {    // same block
    var st = event.data && event.data.type === 'SET_WIDGET_STATE' ? event.data.state : null;
    if (!st) return;
    if (st.replay) tl.restart();
    else if (st.phase !== undefined) window.setExplainerPhase(st.phase);
  });
</script>
```

- On `message` events, honor `SET_WIDGET_STATE` with `state.phase` → `window.setExplainerPhase(state.phase)`. Also accept `{ state: { replay: true } }` → restart (`tl.restart()`).
- In-iframe controls (always visible, small, bottom-center): phase dots `#phase-dots` (button per phase, `id="phase-dot-p0"` etc., current highlighted) + a replay button `id="replay-btn"`. Clicking → `setExplainerPhase` / restart. 44px touch targets.

### 3. Observation contract

{{snippet:interactive-observation}}

For this widget publish:
```json
{ "summary": "Phase 2 (Spark): the solar system race is animating", "state": { "phase": "p2", "phaseIndex": 2 }, "beats": [ {"id":"p0","label":"Hook"}, ... ] }
```
Publish on load, on every phase change (`tl.call(publishCurrentState, [], tl, 'p1')` at each label) and after any seek. Include the phase label list once in `state.beats`.

### 4. widget-config (widget-config REQUIRED)

```json
{
  "type": "animation-explainer",
  "concept": "<topic concept>",
  "description": "<what this animation covers>",
  "beats": [{ "id": "p0", "label": "Hook name" }, { "id": "p1", "label": "..." }, { "id": "p2", "label": "..." }, { "id": "p3", "label": "Title" }],
  "mood": "<motionPersonality>"
}
```

### 5. Robustness (cheap-model safety net)

- Script at end of body; all setup inside one IIFE or DOMContentLoaded; **no top-level `await`**; syntax must be ES5-safe-ish (no optional chaining needed) so the validator never rejects it.
- SVG: inline only, `viewBox` set, no external URLs. Animate with GSAP (`strokeDashoffset`, `scale`, `opacity`), never CSS `@keyframes` conflicts with GSAP on the same element.
- No duplicated documents: exactly ONE `<!DOCTYPE html>`; output the document once.
- Keep total output < ~25 KB of CSS + ~15 KB of JS. Leverage CSS custom properties for the palette.

## Output Format (CRITICAL)

Return ONLY one complete HTML document, no markdown fences, no prose.

## Quality Checklist (verify before output)

- [ ] 4 phases with labels p0–p3 present in the master timeline; total 25–45 s
- [ ] HOOK is a question/stakes/paradox grounded in THIS topic — not a welcome slide
- [ ] Real topic keywords and (example-safe) numbers; the course language is used
- [ ] Palette = the design directive; bg mode respected; one accent discipline; contrast ≥ 4.5:1
- [ ] ≥ 3 entrance easing values; ≥ 3 entrance directions; stagger ≤ 500ms; exits faster than entrances
- [ ] Background decoration ≥ 3 treatments across phases (glow, ghost type, rules/grid)
- [ ] `window.setExplainerPhase` + `SET_WIDGET_STATE` routing + `#phase-dots` + `#replay-btn` work
- [ ] Nudging any phase from `p0` to `p3` never throws and moves its dot (timelines reachable from the API block)
- [ ] `data-maic-observation` publishes phase on load and at every phase label
- [ ] widget-config JSON: type `animation-explainer`, `beats` matches phase labels
- [ ] Offline/static fallback (`no-anim`) leaves content readable; no blank screen
- [ ] Deterministic: replay produces the exact same animation
