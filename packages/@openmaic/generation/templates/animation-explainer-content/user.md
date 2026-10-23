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

Generate the complete HTML motion graphic (the "course trailer"):

- Build phase 1 (HOOK) around the FIRST key point or the topic's central paradox — give the viewer a reason to care in the first 6 seconds.
- Phase 2 (TEASE) visualizes the main key points as 3-4 keyword/icon cards.
- Phase 3 (SPARK) is the signature animated infographic tied to this exact topic's core mechanism (count-up, orbit, transformation, path draw, comparison).
- Phase 4 (TITLE) locks in the course title "{{title}}" and settles into an ambient loop.
- Apply the Design Directive palette strictly; follow the mood for easing and pacing.
- All text in the teaching language.
- Include: `window.setExplainerPhase`, `SET_WIDGET_STATE` listener (`phase` + `replay`), phase dots + replay button, `data-maic-observation` with phase state, and the `widget-config` JSON with `beats` matching your phase labels.
- Deterministic GSAP master timeline (labels p0-p3), total 25-45 s, ambient loop after completion. Static fallback if GSAP is missing.

Return ONLY the HTML document.
