/**
 * The lesson-mix guarantee: the outline prompts ask for interactive and quiz
 * scenes, but an outline model sometimes answers with slides only (the
 * sandbox's fast OpenRouter model did exactly that). Before the run commits
 * its outline, one slide of a slide-heavy outline is converted to the
 * interactive and quiz scenes the lesson still needs to teach by doing and
 * check understanding — the conversion keeps the source scene's title,
 * description and key points, so everything the classroom shows stays in the
 * teaching language.
 *
 * The visual-coverage guarantee ({@link ensureSceneVisuals}) rides the same
 * pass and the same rule: it runs on the outline the ENGINE generated, never
 * on an outline the owner edited and confirmed.
 */
import { randomBytes } from 'node:crypto';

import type { SceneOutline } from '@/lib/types/generation';

/** Scenes the intro explosion already cut into phases (and the cover) are not conversion candidates. */
function isIntroPart(outline: SceneOutline): boolean {
  return !!outline.widgetOutline?.startPhase;
}

/** A plain teaching slide the guarantee may convert. */
function isConvertible(outline: SceneOutline): boolean {
  return (
    outline.type === 'slide' &&
    !outline.widgetType &&
    !outline.widgetOutline &&
    !isIntroPart(outline)
  );
}

/**
 * One interactive widget from a teaching slide: an explorable `diagram`
 * (mindmap) of the slide's key points — the content generator builds the
 * nodes from the outline's teaching content, so the conversion adds no
 * model-facing demand the content templates do not already handle.
 */
function asInteractive(outline: SceneOutline): SceneOutline {
  return {
    ...outline,
    type: 'interactive',
    widgetType: 'diagram',
    widgetOutline: {
      concept: outline.title || outline.description || 'the lesson map',
      diagramType: 'mindmap',
    },
    mediaGenerations: undefined,
    suggestedImageIds: undefined,
  };
}

/** One quiz from a teaching slide's own teaching content and language. */
function asQuiz(outline: SceneOutline): SceneOutline {
  const points =
    outline.keyPoints.length > 0 ? outline.keyPoints : [outline.description].filter(Boolean);
  return {
    ...outline,
    id: `${outline.id}-check`,
    type: 'quiz',
    mediaGenerations: undefined,
    suggestedImageIds: undefined,
    quizConfig: {
      questionCount: Math.max(2, Math.min(5, points.length * 2)),
      difficulty: 'medium',
      questionTypes: ['single', 'multiple'] as ('single' | 'multiple' | 'text')[],
    },
  };
}

/**
 * The heavy scene goes last: the animation-explainer widget is the longest
 * content to generate (its GSAP page dwarfs a slide), and the classroom opens
 * as soon as the first scenes commit — a lesson that OPENS with the explainer
 * makes the learner wait for the slowest scene. The outline model may still
 * write it as scene 1 (it was the intro once), so the engine enforces the
 * order: explainers move to the end, everything else keeps its relative
 * order.
 */
export function moveExplainersToEnd(outlines: readonly SceneOutline[]): SceneOutline[] {
  if (!outlines.some((outline) => outline.widgetType === 'animation-explainer')) {
    return [...outlines];
  }
  const rest = outlines.filter((outline) => outline.widgetType !== 'animation-explainer');
  const explainers = outlines.filter((outline) => outline.widgetType === 'animation-explainer');
  return [...rest, ...explainers].map((outline, index) => ({ ...outline, order: index }));
}

/**
 * The widget a rhythm conversion builds, rotating by position so a lesson
 * alternates HOW the learner does things (explore a map, drive a simulation,
 * watch a concept move) instead of repeating one interaction. A game-shaped
 * teaching style leads with the playable widgets; every rotation keeps to
 * widget types whose minimal widgetOutline the content generator fills from
 * the slide's own teaching content.
 */
const RHYTHM_ROTATION: Record<
  'classic' | 'game' | 'animation',
  readonly NonNullable<SceneOutline['widgetType']>[]
> = {
  classic: ['diagram', 'simulation', 'animation-explainer'],
  game: ['simulation', 'game', 'diagram'],
  animation: ['animation-explainer', 'simulation', 'diagram'],
};

/** The minimal widget outline each rotation pick needs (the concept comes from the slide). */
function rhythmWidgetOutline(
  widgetType: NonNullable<SceneOutline['widgetType']>,
  concept: string,
): SceneOutline['widgetOutline'] {
  switch (widgetType) {
    case 'diagram':
      return { concept, diagramType: 'mindmap' };
    case 'game':
      return { gameType: 'quiz', concept };
    default:
      return { concept };
  }
}

/**
 * The engagement-rhythm guarantee: the outline prompt asks the model to never
 * place two pure-teaching slides back to back (a boredom run — the learner
 * quits), and this pass enforces it in code on the same engine-generated
 * outlines the mix guarantee runs on. Every convertible slide that directly
 * follows another teaching slide becomes the interactive scene the rhythm
 * asks for, its widget rotating by position and teaching style, its title,
 * description and key points riding along so everything stays in the
 * teaching language. The first slide of each pair always survives: a lesson
 * still needs its explanations.
 */
export function ensureEngagementRhythm(
  outlines: readonly SceneOutline[],
  context: { teachingStyle?: 'game' | 'animation' } = {},
): SceneOutline[] {
  const rotation = RHYTHM_ROTATION[context.teachingStyle ?? 'classic'];
  const result = [...outlines];
  let widgetIndex = 0;
  let conversions = 0;
  for (let i = 1; i < result.length - 1; i += 1) {
    const previous = result[i - 1]!;
    const current = result[i]!;
    const previousIsTeaching = previous.type === 'slide' && !previous.widgetType;
    if (!previousIsTeaching || !isConvertible(current)) continue;
    const widgetType = rotation[widgetIndex % rotation.length]!;
    widgetIndex += 1;
    conversions += 1;
    const concept = current.description?.trim() || current.title?.trim() || 'the lesson map';
    result[i] = {
      ...current,
      type: 'interactive',
      widgetType,
      widgetOutline: rhythmWidgetOutline(widgetType, concept),
      mediaGenerations: undefined,
      suggestedImageIds: undefined,
    };
  }
  if (conversions > 0) {
    return result.map((outline, index) => ({ ...outline, order: index }));
  }
  return result;
}

/**
 * Fill a slide-heavy outline's mix: one interactive scene among the middle
 * teaching scenes, and one quiz built from a teaching scene just before the
 * end. Slides a finite budget left over keep the summary instruction light:
 * both fixes prefer CONVERTING a slide (no scene count change). Returns the
 * outline unchanged when the mix is already there or the course is too short
 * to need it.
 */
export function ensureLessonMix(
  outlines: readonly SceneOutline[],
  maxScenes?: number,
): SceneOutline[] {
  // A two-scene outline is degenerate; from three scenes up the lesson still
  // needs its interactive and its quiz.
  if (outlines.length < 3) return [...outlines];
  const hasQuiz = outlines.some((outline) => outline.type === 'quiz');
  const hasInteractive = outlines.some((outline) => outline.type === 'interactive');
  if (hasQuiz && hasInteractive) return [...outlines];

  const result = [...outlines];

  if (!hasInteractive) {
    // The first convertible teaching scene after the opening, never the
    // closing one (that is where the quiz goes).
    const index = result.findIndex(
      (outline, i) => i >= 1 && i <= result.length - 2 && isConvertible(outline),
    );
    if (index >= 0) result[index] = asInteractive(result[index]!);
  }

  if (!hasQuiz) {
    // Under the budget: insert a quiz derived from the latest convertible
    // teaching scene before the closing scene. At the budget: convert the
    // penultimate scene when it is a convertible slide, else the latest
    // convertible one.
    if (maxScenes === undefined || result.length < maxScenes) {
      let source = result[result.length - 2] ?? result[result.length - 1];
      for (let i = result.length - 2; i >= 1; i -= 1) {
        if (isConvertible(result[i]!)) {
          source = result[i]!;
          break;
        }
      }
      if (source) {
        result.splice(result.length - 1, 0, asQuiz(source));
      }
    } else {
      for (let i = result.length - 2; i >= 1; i -= 1) {
        if (isConvertible(result[i]!)) {
          result[i] = asQuiz(result[i]!);
          break;
        }
      }
    }
  }

  return result.map((outline, index) => ({ ...outline, order: index }));
}

/**
 * The media-generation budget the outline schema enforces on one outline
 * (`normalizeSceneOutlines` slices past it): the visual guarantee stops
 * injecting at the same ceiling rather than committing an outline the
 * schema would trim.
 */
const MAX_TOTAL_MEDIA_GENERATIONS = 20;

/**
 * Whether a scene's outline already plans a visual: a generated image/video
 * request, or a source image the material analysis found. Interactive and
 * PBL scenes do not need the check — their widget/project content is the
 * visual — and quizzes are deliberately exempt (a quiz is a text
 * assessment; the design keeps it one).
 */
function isVisualScene(outline: SceneOutline): boolean {
  if (outline.type !== 'slide') return true;
  return (
    (outline.mediaGenerations?.length ?? 0) > 0 || (outline.suggestedImageIds?.length ?? 0) > 0
  );
}

/**
 * The image request a bare teaching slide gets: art direction built from the
 * slide's own teaching content (the subject first, then the key points it
 * must cover), closed with the style and label-language rules the outline
 * snippet demands of the model's own requests. An empty slide (no title, no
 * description, no key points) has nothing to illustrate and stays bare —
 * there is no honest prompt for it.
 */
function asVisualSlide(outline: SceneOutline, designDirective: string | undefined): SceneOutline {
  const subject = outline.description?.trim() || outline.title?.trim();
  const points = outline.keyPoints
    .map((point) => point.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!subject && points.length === 0) return outline;
  const prompt = [
    `Educational illustration for a lesson slide${subject ? ` about: ${subject}` : ''}`,
    points.length > 0 ? `The image must visually cover: ${points.join('; ')}.` : '',
    'Clean modern flat vector illustration, strong focal subject, consistent palette, no watermark.',
    'If the image contains any text or labels, write all of them in the course teaching language.',
    designDirective ? `Match this design direction: ${designDirective}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    ...outline,
    mediaGenerations: [
      ...(outline.mediaGenerations ?? []),
      {
        type: 'image',
        prompt,
        elementId: `gen_img_${randomBytes(6).toString('base64url')}`,
        aspectRatio: '16:9' as const,
      },
    ],
  };
}

/**
 * The visual-coverage guarantee: every teaching slide a run commits plans at
 * least one visual, so the classroom never opens a scene that renders as
 * bare text. The outline prompts ask the model for this (the image
 * instructions carry the per-slide quota), but an outline model that answers
 * with text-only slides — the common drift — used to pass every check. One
 * slide at a time, in outline order, a bare slide gets one image request
 * derived from its own teaching content, until the media budget the schema
 * enforces is reached. The pass never touches interactive, PBL or quiz
 * scenes, and never removes a planned visual.
 */
export function ensureSceneVisuals(
  outlines: readonly SceneOutline[],
  context: { designDirective?: string } = {},
): SceneOutline[] {
  let budget =
    MAX_TOTAL_MEDIA_GENERATIONS -
    outlines.reduce((count, outline) => count + (outline.mediaGenerations?.length ?? 0), 0);
  if (budget <= 0) return [...outlines];
  return outlines.map((outline) => {
    if (isVisualScene(outline)) return outline;
    const injected = asVisualSlide(outline, context.designDirective);
    if (injected === outline) return outline;
    budget -= 1;
    return injected;
  });
}
