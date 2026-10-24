Create the opening MOTION-GRAPHIC EXPLAINER for: {{title}}

## Concept

{{concept}}

## what to cover (from the course planner)

{{description}}

## Key Points

{{keyPoints}}

## Story Beats

{{beats}}

## Mood

{{mood}}

## Design Directive

{{designDirective}}

## Language

{{languageDirective}}

---

Generate the complete HTML motion graphic (the "course trailer").

Playback contract (the classroom plays this intro ONE BEAT PER SCENE — this exact HTML is shared by those scenes):

- Boot to a designed static poster (CSS-visible, readable, nothing moving) with the master timeline `paused: true`; every tween `fromTo(..., { immediateRender: false })`. NO autoplay.
- One phase per Story Beat above: label them `p0`…`pN` on the master timeline in that order (p0 first). Total ~25–45 s.
- The animation starts ONLY when a `SET_WIDGET_STATE` message arrives with `state.phase`; `playPhase` seeks to that label, plays ONLY that segment (`tweenTo` the next label), then hands off to the ambient loop. Never auto-advance into the next phase.

Build instructions:

- Build phase p0 (HOOK) around the FIRST key point or the topic's central paradox — give the viewer a reason to care in the first 6 seconds.
- The middle phases visualize the main key points as 3-4 keyword/icon cards and one signature animated infographic tied to this exact topic's core mechanism (count-up, orbit, transformation, path draw, comparison).
- The LAST phase locks in the course title "{{title}}" and settles into an ambient loop.
- Apply the Design Directive palette strictly; follow the mood for easing and pacing.
- All text in the teaching language.
- Include: `window.setExplainerPhase`, `SET_WIDGET_STATE` listener (`phase` plays a beat, `replay` re-plays the current beat), phase dots + replay button, `data-maic-observation` with phase state, and the `widget-config` JSON with `beats` matching your phase labels.
- Deterministic GSAP master timeline (labels p0-pN, paused at boot), ambient loop after each segment completes. Static poster fallback if GSAP is missing.

Return ONLY the HTML document.
