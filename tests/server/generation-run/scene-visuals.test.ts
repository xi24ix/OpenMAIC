import { describe, expect, it } from 'vitest';

import type { SceneOutline } from '@/lib/types/generation';

import { ensureSceneVisuals } from '@/lib/server/generation/run/lesson-mix';

/** A minimal outline of a given type, with the fields the visual pass reads. */
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
    keyPoints: ['نقطة أولى', 'نقطة ثانية'],
    order: 0,
    ...overrides,
  };
}

describe('ensureSceneVisuals', () => {
  it('injects one image request into a bare teaching slide', () => {
    const result = ensureSceneVisuals([outlineOf('s1', 'slide'), outlineOf('s2', 'quiz')]);
    const slide = result[0]!;
    expect(slide.mediaGenerations).toHaveLength(1);
    const request = slide.mediaGenerations![0]!;
    expect(request.type).toBe('image');
    expect(request.elementId).toMatch(/^gen_img_[\w-]+$/);
    expect(request.aspectRatio).toBe('16:9');
    // The prompt is art direction built from the slide's own teaching content.
    expect(request.prompt).toContain(slide.description);
    expect(request.prompt).toContain('نقطة أولى');
    // The label-language rule rides along.
    expect(request.prompt).toContain('course teaching language');
    // Quizzes are deliberately exempt.
    expect(result[1]!.mediaGenerations).toBeUndefined();
  });

  it('leaves interactive, PBL and quiz scenes untouched even when bare', () => {
    const original = [
      outlineOf('s1', 'interactive', { widgetType: 'simulation' }),
      outlineOf('s2', 'pbl'),
      outlineOf('s3', 'quiz'),
    ];
    const result = ensureSceneVisuals(original);
    expect(result.map((o) => o.mediaGenerations)).toEqual([undefined, undefined, undefined]);
  });

  it('keeps a slide that already plans a visual unchanged', () => {
    const planned = outlineOf('s1', 'slide', {
      mediaGenerations: [
        { type: 'image', prompt: 'a prepared diagram', elementId: 'gen_img_abc123' },
      ],
    });
    const reused = outlineOf('s2', 'slide', { suggestedImageIds: ['img_3'] });
    const result = ensureSceneVisuals([planned, reused]);
    expect(result[0]!.mediaGenerations).toHaveLength(1);
    expect(result[0]!.mediaGenerations![0]!.elementId).toBe('gen_img_abc123');
    expect(result[1]!.mediaGenerations).toBeUndefined();
  });

  it('gives every bare slide its own unique element id', () => {
    const result = ensureSceneVisuals([
      outlineOf('s1', 'slide'),
      outlineOf('s2', 'slide'),
      outlineOf('s3', 'slide'),
    ]);
    const ids = result.map((o) => o.mediaGenerations![0]!.elementId);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^gen_img_[\w-]+$/);
  });

  it('stops injecting at the outline schema media budget', () => {
    const prepared = Array.from({ length: 20 }, (_, i) =>
      outlineOf(`p${i}`, 'slide', {
        mediaGenerations: [{ type: 'image', prompt: `p${i}`, elementId: `gen_img_p${i}` }],
      }),
    );
    prepared.push(outlineOf('bare', 'slide'));
    const result = ensureSceneVisuals(prepared);
    expect(result.find((o) => o.id === 'bare')!.mediaGenerations).toBeUndefined();
    const total = result.reduce((count, o) => count + (o.mediaGenerations?.length ?? 0), 0);
    expect(total).toBe(20);
  });

  it('leaves an empty slide alone: no honest prompt exists for it', () => {
    const empty = outlineOf('s1', 'slide', { title: '', description: '', keyPoints: [] });
    const result = ensureSceneVisuals([empty]);
    expect(result[0]!.mediaGenerations).toBeUndefined();
  });

  it('threads the design directive into the injected prompt', () => {
    const result = ensureSceneVisuals([outlineOf('s1', 'slide')], {
      designDirective: 'Palette: #1a1f2e on #e8ecf4; motionPersonality: playful',
    });
    expect(result[0]!.mediaGenerations![0]!.prompt).toContain('#1a1f2e');
  });

  it('is idempotent: a second pass adds nothing', () => {
    const first = ensureSceneVisuals([outlineOf('s1', 'slide'), outlineOf('s2', 'slide')]);
    const second = ensureSceneVisuals(first);
    expect(second.map((o) => o.mediaGenerations?.length ?? 0)).toEqual([1, 1]);
  });
});
