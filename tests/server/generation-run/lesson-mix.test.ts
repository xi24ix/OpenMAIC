import { describe, expect, it } from 'vitest';

import type { SceneOutline } from '@/lib/types/generation';

import { ensureLessonMix, moveExplainersToEnd } from '@/lib/server/generation/run/lesson-mix';

/** A minimal outline of a given type, with the fields the mix reads. */
function outlineOf(
  id: string,
  type: SceneOutline['type'],
  overrides: Partial<SceneOutline> = {},
): SceneOutline {
  return {
    id,
    type,
    title: `Scene ${id}`,
    description: 'أحد مشاهد الدرس',
    keyPoints: ['نقطة', 'أخرى'],
    order: 0,
    ...overrides,
  };
}

/** All-slides outline like the fast sandbox model produced. */
function allSlides(count: number): SceneOutline[] {
  return Array.from({ length: count }, (_, i) => outlineOf(`s${i + 1}`, 'slide'));
}

describe('moveExplainersToEnd', () => {
  it('moves the animation-explainer to the last scene, keeping the rest in order', () => {
    const outlines = [
      outlineOf('s1', 'interactive', { widgetType: 'animation-explainer' }),
      outlineOf('s2', 'slide'),
      outlineOf('s3', 'interactive', { widgetType: 'simulation' }),
      outlineOf('s4', 'quiz'),
    ];
    const result = moveExplainersToEnd(outlines);
    expect(result.map((o) => o.id)).toEqual(['s2', 's3', 's4', 's1']);
    expect(result.map((o) => o.order)).toEqual([0, 1, 2, 3]);
    expect(result[3]!.widgetType).toBe('animation-explainer');
  });

  it('is a no-op without an explainer', () => {
    const outlines = [outlineOf('s1', 'slide'), outlineOf('s2', 'quiz')];
    expect(moveExplainersToEnd(outlines)).toEqual(outlines);
  });
});

describe('ensureLessonMix', () => {
  it('converts a slide of an all-slide outline into one interactive scene and one quiz', () => {
    const result = ensureLessonMix(allSlides(6));
    const types = result.map((o) => o.type);
    expect(types.filter((t) => t === 'interactive')).toHaveLength(1);
    expect(types.filter((t) => t === 'quiz')).toHaveLength(1);
    // The converted scenes keep their source teaching content...
    const interactive = result.find((o) => o.type === 'interactive')!;
    expect(interactive.title).toBe('Scene s2');
    expect(interactive.widgetType).toBe('diagram');
    expect(interactive.widgetOutline?.diagramType).toBe('mindmap');
    const quiz = result.find((o) => o.type === 'quiz')!;
    // ...and the quiz is derived from teaching content near the end.
    expect(quiz.id.endsWith('-check')).toBe(true);
    expect(quiz.keyPoints.length).toBeGreaterThan(0);
    expect(quiz.quizConfig?.questionTypes).toEqual(['single', 'multiple']);
  });

  it('leaves a mix that already has an interactive and a quiz unchanged', () => {
    const original = [outlineOf('s1', 'slide'), outlineOf('s2', 'interactive'), outlineOf('s3', 'quiz'), outlineOf('s4', 'slide')];
    const result = ensureLessonMix(original);
    expect(result.map((o) => o.type)).toEqual(original.map((o) => o.type));
    expect(result.map((o) => o.id)).toEqual(original.map((o) => o.id));
  });

  it('converts only what is missing (interactive present, quiz absent)', () => {
    const original = [outlineOf('s1', 'slide'), outlineOf('s2', 'interactive'), outlineOf('s3', 'slide'), outlineOf('s4', 'slide')];
    const result = ensureLessonMix(original);
    expect(result.filter((o) => o.type === 'interactive')).toHaveLength(1);
    expect(result.filter((o) => o.type === 'quiz')).toHaveLength(1);
  });

  it('inserts a quiz before the closing scene when the scene budget allows it', () => {
    const result = ensureLessonMix(allSlides(6), 8);
    expect(result).toHaveLength(7); // one interactive converted + one quiz inserted
    const types = result.map((o) => o.type);
    expect(types[0]).toBe('slide');
    expect(types[types.length - 1]).toBe('slide');
    // The quiz rides right before the closing summary.
    expect(types[types.length - 2]).toBe('quiz');
  });

  it('converts instead of inserting when the run is already at its scene budget', () => {
    const result = ensureLessonMix(allSlides(6), 6);
    expect(result).toHaveLength(6);
    // The interactive goes to teaching middle, the quiz takes the penultimate slide.
    expect(result[1]!.type).toBe('interactive');
    expect(result[4]!.type).toBe('quiz');
  });

  it('skips the explosion phases and the cover: the intro stays whole', () => {
    const intro = (id: string, startPhase: boolean): SceneOutline =>
      outlineOf(id, 'interactive', {
        widgetType: 'animation-explainer',
        widgetOutline: {
          concept: 'the hook',
          keyBeats: ['beat'],
          mood: 'curious',
          ...(startPhase ? { startPhase: 'p0' as const } : {}),
        },
      });
    const outlines = [intro('s1', true), outlineOf('s2', 'slide'), outlineOf('s3', 'slide'), outlineOf('s4', 'slide'), outlineOf('s5', 'slide')];
    const result = ensureLessonMix(outlines, 8);    expect(result[0]!.type).toBe('interactive');
    expect(result[0]!.widgetType).toBe('animation-explainer');
    expect(result.filter((o) => o.type === 'quiz')).toHaveLength(1);
  });

  it('mixes a three-scene outline: the quiz inserts, keeping every scene under the budget', () => {
    const original = allSlides(3);
    const result = ensureLessonMix(original, 8);
    expect(result.map((o) => o.type)).toEqual(['slide', 'interactive', 'quiz', 'slide']);
  });

  it('leaves a two-scene outline alone', () => {
    const original = allSlides(2);
    const result = ensureLessonMix(original, 8);
    expect(result.map((o) => o.type)).toEqual(['slide', 'slide']);
  });

  it('does not convert the lone convertible slide when only a quiz is missing at budget', () => {
    // 4 scenes at an 8 budget with the mix present except the quiz: insert.
    const original = [outlineOf('s1', 'slide'), outlineOf('s2', 'slide'), outlineOf('s3', 'interactive'), outlineOf('s4', 'slide')];
    const result = ensureLessonMix(original, 8);
    expect(result).toHaveLength(5);
    expect(result.filter((o) => o.type === 'quiz')).toHaveLength(1);
  });

  it('renumbers order after inserting', () => {
    const result = ensureLessonMix(allSlides(5), 8);
    expect(result.map((o) => o.order)).toEqual(result.map((_, i) => i));
  });

  it('is idempotent: a mixed outline runs through unchanged', () => {
    const first = ensureLessonMix(allSlides(6), 8);
    const second = ensureLessonMix(first, 8);
    expect(second.map((o) => o.id)).toEqual(first.map((o) => o.id));
    expect(second.map((o) => o.type)).toEqual(first.map((o) => o.type));
  });
});
