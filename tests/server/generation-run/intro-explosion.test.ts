import { describe, expect, it } from 'vitest';

import type { SceneOutline } from '@/lib/types/generation';

import { explodeExplainerOutlines } from '@/lib/server/generation/run/intro-explosion';

/** A minimal outline of a given type, with the fields the explosion reads. */
function outlineOf(
  id: string,
  type: SceneOutline['type'],
  overrides: Partial<SceneOutline> = {},
): SceneOutline {
  return {
    id,
    type,
    title: `Scene ${id}`,
    description: 'A scene',
    keyPoints: ['one'],
    order: 0,
    ...overrides,
  };
}

/** An animation-explainer intro outline with `beatCount` story beats. */
function explainerOf(id: string, beatCount: number): SceneOutline {
  return outlineOf(id, 'interactive', {
    widgetType: 'animation-explainer',
    widgetOutline: {
      concept: 'the hook',
      keyBeats: Array.from({ length: beatCount }, (_, i) => `beat ${i}`),
      mood: 'curious',
    },
  });
}

describe('intro explosion scene budget', () => {
  it('explodes without a budget exactly as before: one scene per beat plus the cover', () => {
    const body = [outlineOf('s2', 'slide'), outlineOf('s3', 'quiz')];
    const result = explodeExplainerOutlines([explainerOf('s1', 4), ...body]);
    // 4 beats → 3 widget siblings + 1 cover slide, then the body in order.
    expect(result.map((o) => o.id)).toEqual(['s1-p0', 's1-p1', 's1-p2', 's1-cover', 's2', 's3']);
    expect(result.map((o) => o.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('caps the intro at ~40% of the budget and fits the body into the rest', () => {
    // 8 scenes: cap = ceil(8 * 0.4) = 4 → 3 beats + cover; body keeps 4.
    const body = [
      outlineOf('s2', 'slide'),
      outlineOf('s3', 'interactive'),
      outlineOf('s4', 'quiz'),
      outlineOf('s5', 'slide'),
      outlineOf('s6', 'slide'),
      outlineOf('s7', 'slide'),
      outlineOf('s8', 'slide'),
    ];
    const result = explodeExplainerOutlines([explainerOf('s1', 4), ...body], 8);
    expect(result).toHaveLength(8);
    expect(result.filter((o) => o.widgetOutline?.groupId)).toHaveLength(3);
    expect(result[3]!.type).toBe('slide'); // the cover
    expect(result.slice(4).map((o) => o.id)).toEqual(['s2', 's3', 's4', 's5']);
  });

  it('keeps the widget whole when the budget cannot fit a group', () => {
    // A group cut in half would leave phases without scenes, and dropping the
    // teaching scene would leave no lesson: with a budget of 2 the intro
    // stays one widget scene and the teaching scene stays.
    const result = explodeExplainerOutlines([explainerOf('s1', 4), outlineOf('s2', 'slide')], 2);
    expect(result.map((o) => o.id)).toEqual(['s1', 's2']);
    expect(result[0]!.widgetType).toBe('animation-explainer');
    expect(result[0]!.widgetOutline?.startPhase).toBeUndefined();
  });

  it('passes through outlines with nothing to explode', () => {
    const outlines = [outlineOf('s1', 'slide'), explainerOf('s2', 1)];
    const result = explodeExplainerOutlines(outlines, 5);
    // A single-beat explainer cannot be cut; it rides along unchanged.
    expect(result).toHaveLength(2);
    expect(result[1]!.id).toBe('s2');
  });

  it('is idempotent: already-exploded outlines pass through', () => {
    const exploded = explodeExplainerOutlines([explainerOf('s1', 4)]);
    const again = explodeExplainerOutlines(exploded, 8);
    expect(again.map((o) => o.id)).toEqual(exploded.map((o) => o.id));
  });
});
