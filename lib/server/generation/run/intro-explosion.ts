/**
 * The intro explosion: one animation-explainer outline becomes one classroom
 * scene per story beat, plus a title-card slide that doubles as the course's
 * homepage cover.
 *
 * Why: the classroom plays scenes one by one (its play/stop, its voice, its
 * transcript), but a single intro widget free-ran all beats ("all scenes are
 * played fast in one scene") and started before the user pressed play. The
 * widget keeps ONE rendering of every beat — the same generated HTML is
 * shared across the group — and each classroom scene drives exactly one
 * labeled phase (`p0…pN`) of that master timeline through
 * `widget_setState`. The first sibling scene's content generation pays for
 * the model call; the rest copy it at zero cost (the run engine memoizes by
 * `widgetOutline.groupId`).
 *
 * The last beat is exploded as a `slide` instead of a widget phase: a
 * designed title card that (a) gives the classroom a breathing point between
 * the intro and the body of the lesson and (b) is the first slide of the
 * document, so the existing first-slide thumbnail pipeline gives the library
 * card its cover. The slide replaces the widget's own title phase; the class
 * never seeks to the last widget label, so nothing on screen duplicates.
 *
 * Idempotence on purpose: `widgetOutline.startPhase` presence marks an
 * outline as already exploded, so the confirm/edit round-trip (which re-runs
 * this pass on user-edited outlines) never explodes twice. Beats order with
 * the group: per-beat interactive scenes in beat order, then the title card.
 */
import type { SceneOutline } from '@/lib/types/generation';

/**
 * Cap the explosion — an outline whose beats list is enormous would multiply
 * scenes (token spend, classroom length) without pedagogical gain. The
 * defaults match `scene-generator.ts`'s fallback beats exactly.
 */
const MAX_INTRO_SCENES = 6;

const DEFAULT_KEY_BEATS = [
  'Hook — open on the central question or paradox',
  'Tease — the main key points as keyword cards',
  'Spark — the signature animated infographic',
  'Title — lock up the lesson title and settle',
];

/** The human beat label the scene header shows, derived from a key-beat line. */
function beatLabel(keyBeat: string | undefined, index: number): string {
  const first = (keyBeat ?? '')
    .replace(/^[\s*•\-]+/, '')
    .split(/[—–:\n|]/)[0]!
    .trim();
  if (first) return first.slice(0, 40);
  return index === 0 ? 'Hook' : `Beat ${index + 1}`;
}

/** Whether an outline is a not-yet-exploded animation-explainer. */
function isExplodable(outline: SceneOutline): boolean {
  return (
    outline.type === 'interactive' &&
    outline.widgetType === 'animation-explainer' &&
    !!outline.widgetOutline &&
    !outline.widgetOutline.startPhase
  );
}

/**
 * Explode-one: an explainer outline with N widget beats becomes N-1
 * interactive siblings + 1 title-card slide. An outline with fewer than two
 * widget beats cannot be meaningfully cut; it passes through unchanged.
 */
function explodeOne(outline: SceneOutline): SceneOutline[] {
  if (!isExplodable(outline)) return [outline];
  const base = outline.widgetOutline!;
  const beats = base.keyBeats && base.keyBeats.length > 0 ? base.keyBeats : DEFAULT_KEY_BEATS;
  // Widget beats = everything except a trailing title beat; the title card
  // slide takes its job. Hard-cap the group at MAX_INTRO_SCENES scenes:
  // `trimmed` is what every sibling's widgetOutline carries, so the shared
  // widget generates exactly as many phases as there are per-beat scenes —
  // beat i of the trimmed list is phase p_i of classroom scene i.
  const sceneCount = Math.min(beats.length, MAX_INTRO_SCENES);
  if (sceneCount < 2) return [outline];
  const trimmed = beats.slice(0, sceneCount);

  const groupId = `explainer:${outline.id}`;
  const { startPhase: _ignored, ...baseFields } = base;

  const concept = base.concept || outline.description || outline.title;
  const siblings: SceneOutline[] = [];

  for (let i = 0; i < sceneCount - 1; i += 1) {
    const label = beatLabel(trimmed[i], i);
    siblings.push({
      ...outline,
      id: `${outline.id}-p${i}`,
      title: label.length < 4 ? `${label} — ${outline.title}` : label,
      description: `${label}: one self-contained cut of the course's motion-graphic intro. The animation and the teacher's voice start when the classroom playback reaches this scene. (Concept: ${concept.slice(0, 160)})`,
      keyPoints: [],
      widgetOutline: {
        ...baseFields,
        keyBeats: trimmed,
        startPhase: `p${i}`,
        phaseLabel: label,
        beatIndex: i,
        beatCount: sceneCount,
        groupId,
      },
      // Generated media is requested per outline; only the group's shared
      // generation covers it. Duplicate requests across siblings would spend
      // media generations N times for the same widget.
      mediaGenerations: undefined,
      suggestedImageIds: undefined,
    });
  }

  // Title-card slide (the last key beat's job): the course cover.
  const titleBeatLabel = beatLabel(trimmed[trimmed.length - 1], trimmed.length - 1);
  siblings.push({
    ...outline,
    id: `${outline.id}-cover`,
    type: 'slide',
    title: outline.title,
    description: `Title card (cover slide): design a single bold lockup of the lesson title "${outline.title}" with at most one short tagline beneath it — no content bullets, no teaching body. It follows ${titleBeatLabel} and settles the intro. (Beat label: ${titleBeatLabel})`,
    keyPoints: [
      `Lesson title: ${outline.title}`,
      `${titleBeatLabel}: one-line tagline only, no content points`,
    ],
    widgetType: undefined,
    widgetOutline: undefined,
    mediaGenerations: undefined,
    suggestedImageIds: undefined,
  });

  return siblings.map((s, i) => ({ ...s, order: i }));
}

/**
 * Explode every animation-explainer outline in the confirmed outline into
 * per-beat scenes + a title-card cover slide, then renumber `order`
 * 0..n-1 (exploded siblings must trail their group's monotonically).
 */
export function explodeExplainerOutlines(
  outlines: readonly SceneOutline[],
): SceneOutline[] {
  const exploded: SceneOutline[] = [];
  for (const outline of outlines) {
    exploded.push(...explodeOne(outline));
  }
  return exploded.map((outline, index) => ({ ...outline, order: index }));
}
