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
 * The guarantee runs on the outline the ENGINE generated (the auto-confirm
 * path and the outline a `wait` run reviews), never on an outline the owner
 * edited and confirmed: an edit expresses the owner's intent.
 */
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
  const points = outline.keyPoints.length > 0 ? outline.keyPoints : [outline.description].filter(Boolean);
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
