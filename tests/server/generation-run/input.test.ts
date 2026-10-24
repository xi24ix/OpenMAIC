/**
 * What `POST /api/generation-runs` and the commands accept, and how a run
 * classifies a step failure for its retries (as the step's route would).
 */
import { describe, expect, it, vi } from 'vitest';

import { StepRefusal } from '@/lib/server/generation/steps/context';
import { normalizeSceneOutlines } from '@/lib/server/generation/outline-schema';
import {
  MAX_OUTLINE_JSON_BYTES,
  MAX_OUTLINE_SCENES,
  MAX_START_BODY_BYTES,
  parseCommandId,
  parseConfirmOutline,
  parseOutlines,
  parseRunInput,
  readJsonBody,
} from '@/lib/server/generation/run/input';
import { withRouteRetry } from '@/lib/server/generation/run/retry';

describe('run input', () => {
  it('fills the defaults: no materials, generated agents, waiting outline review', () => {
    expect(parseRunInput({ requirement: 'Teach fractions' })).toEqual({
      ok: true,
      value: {
        requirement: 'Teach fractions',
        materialIds: [],
        interactive: false,
        taskEngine: false,
        agents: { mode: 'auto' },
        outlineReview: 'wait',
      },
    });
  });

  it('keeps every field a run reads, and no keys or models', () => {
    const parsed = parseRunInput({
      requirement: 'Teach fractions',
      materialIds: ['mat_00000000000000000000000000', 'mat_00000000000000000000000000'],
      interactive: true,
      taskEngine: true,
      agents: { mode: 'preset', agentIds: ['default-1', 'default-1', 'default-2'] },
      learnerProfile: { nickname: ' Sam ', bio: '' },
      outlineReview: 'auto',
      voice: { providerId: 'openai-tts', voiceId: 'alloy', speed: 1.25 },
      apiKey: 'sk-ignored',
      model: 'ignored',
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        requirement: 'Teach fractions',
        materialIds: ['mat_00000000000000000000000000'],
        interactive: true,
        taskEngine: true,
        agents: { mode: 'preset', agentIds: ['default-1', 'default-2'] },
        learnerProfile: { nickname: 'Sam' },
        outlineReview: 'auto',
        voice: { providerId: 'openai-tts', voiceId: 'alloy', speed: 1.25 },
      },
    });
  });

  it('accepts a bounded hard scene ceiling for focused lesson runs', () => {
    expect(parseRunInput({ requirement: 'Teach fractions', maxScenes: 3 })).toMatchObject({
      ok: true,
      value: { maxScenes: 3 },
    });
    expect(parseRunInput({ requirement: 'Teach fractions', maxScenes: 0 }).ok).toBe(false);
    expect(parseRunInput({ requirement: 'Teach fractions', maxScenes: 101 }).ok).toBe(false);
  });

  it('keeps releaseMaterials only for a run with materials', () => {
    expect(
      parseRunInput({
        requirement: 'x',
        materialIds: ['mat_00000000000000000000000000'],
        releaseMaterials: true,
      }),
    ).toMatchObject({ ok: true, value: { releaseMaterials: true } });
    const none = parseRunInput({ requirement: 'x', releaseMaterials: true });
    expect(none.ok && 'releaseMaterials' in none.value).toBe(false);
    expect(parseRunInput({ requirement: 'x', releaseMaterials: 'yes' }).ok).toBe(false);
  });

  it('reads an empty preset selection as the default presets (resolved by the run)', () => {
    expect(
      parseRunInput({ requirement: 'x', agents: { mode: 'preset', agentIds: [] } }),
    ).toMatchObject({ ok: true, value: { agents: { mode: 'preset', agentIds: [] } } });
    expect(parseRunInput({ requirement: 'x', agents: { mode: 'auto' } })).toMatchObject({
      ok: true,
      value: { agents: { mode: 'auto' } },
    });
  });

  it.each([
    [{}, /requirement/],
    [{ requirement: '  ' }, /requirement/],
    [{ requirement: 'x', materialIds: ['nope'] }, /materialIds/],
    [{ requirement: 'x', agents: { mode: 'preset', agentIds: [''] } }, /agentIds/],
    [{ requirement: 'x', agents: { mode: 'preset' } }, /agentIds/],
    [{ requirement: 'x', agents: { mode: 'random' } }, /agents must be/],
    [{ requirement: 'x', outlineReview: 'skip' }, /outlineReview/],
    [{ requirement: 'x', interactive: 'yes' }, /interactive/],
    [
      { requirement: 'x', voice: { providerId: 'openai-tts', voiceId: 'alloy', speed: 9 } },
      /voice/,
    ],
  ])('refuses %j', (body, message) => {
    const parsed = parseRunInput(body);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.message).toMatch(message);
  });

  it('numbers an edited outline by its order in the list, as the browser editor does', () => {
    const scene = (id: string, order: number) => ({ id, type: 'slide', title: id, order });
    const parsed = parseConfirmOutline({
      commandId: 'c',
      outlineRevision: 1,
      outlines: [scene('b', 7), scene('a', 7), scene('c', 2)],
    });
    expect(parsed.ok && parsed.value.outlines!.map((o) => [o.id, o.order])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 3],
    ]);
  });

  it('checks commands', () => {
    expect(parseCommandId('a1:b-2.c_3')).toEqual({ ok: true, value: 'a1:b-2.c_3' });
    expect(parseCommandId('has space').ok).toBe(false);
    expect(parseConfirmOutline({ commandId: 'c', outlineRevision: 0 }).ok).toBe(false);
    expect(parseConfirmOutline({ commandId: 'c', outlineRevision: 2 })).toEqual({
      ok: true,
      value: { commandId: 'c', outlineRevision: 2 },
    });
    const outline = { id: 'o1', type: 'slide', title: 'T', order: 1 };
    expect(
      parseConfirmOutline({ commandId: 'c', outlineRevision: 1, outlines: [outline, outline] }),
    ).toMatchObject({ ok: false, message: /repeat/ });
    expect(
      parseConfirmOutline({ commandId: 'c', outlineRevision: 1, outlines: [{ id: 'o1' }] }).ok,
    ).toBe(false);
    expect(
      parseConfirmOutline({ commandId: 'c', outlineRevision: 1, outlines: [outline] }),
    ).toEqual({
      ok: true,
      value: {
        commandId: 'c',
        outlineRevision: 1,
        outlines: [{ ...outline, description: '', keyPoints: [] }],
      },
    });
  });
});

describe('outline validation', () => {
  const outline = (overrides: Record<string, unknown> = {}) => ({
    id: 'o1',
    type: 'slide',
    title: 'Intro',
    description: 'Why',
    keyPoints: ['a', 'b'],
    order: 1,
    ...overrides,
  });

  it('keeps the outline schema and drops members it does not know', () => {
    const parsed = parseOutlines([
      outline({
        mediaGenerations: [{ type: 'image', prompt: 'a leaf', elementId: 'gen_img_1' }],
        quizConfig: { questionCount: 3, difficulty: 'easy', questionTypes: ['single'] },
        widgetType: 'diagram',
        widgetOutline: { concept: 'flow', nodeCount: 4 },
        notes: 'not part of the schema',
      }),
    ]);
    expect(parsed).toEqual({
      ok: true,
      value: [
        {
          id: 'o1',
          type: 'slide',
          title: 'Intro',
          description: 'Why',
          keyPoints: ['a', 'b'],
          order: 1,
          mediaGenerations: [{ type: 'image', prompt: 'a leaf', elementId: 'gen_img_1' }],
          quizConfig: { questionCount: 3, difficulty: 'easy', questionTypes: ['single'] },
          widgetType: 'diagram',
          widgetOutline: { concept: 'flow', nodeCount: 4 },
        },
      ],
    });
  });

  it('is lenient where a model is loose: nulls are absent, wrong optional shapes dropped', () => {
    const modelStyle = [
      {
        id: 'o1',
        type: 'quiz',
        title: 'Check',
        description: null,
        keyPoints: ['a', '', '  ', 7, null, 'b'],
        teachingObjective: null,
        estimatedDuration: 'five minutes',
        order: 1,
        suggestedImageIds: null,
        mediaGenerations: [
          { type: 'image', prompt: 'a leaf', elementId: 'gen_img_1', aspectRatio: 'wide' },
          { type: 'gif', prompt: 'p', elementId: 'e' },
          null,
        ],
        quizConfig: { questionCount: 3, difficulty: 'tricky', questionTypes: ['single', 'essay'] },
        pblConfig: { projectTopic: 'Garden', projectDescription: null },
        widgetType: 'chart',
        widgetOutline: { concept: 'flow', nodes: null, steps: ['x', null] },
        extra: { anything: true },
      },
    ];
    const parsed = parseOutlines(modelStyle);
    expect(parsed).toEqual({
      ok: true,
      value: [
        {
          id: 'o1',
          type: 'quiz',
          title: 'Check',
          description: '',
          keyPoints: ['a', 'b'],
          order: 1,
          mediaGenerations: [{ type: 'image', prompt: 'a leaf', elementId: 'gen_img_1' }],
          pblConfig: { projectTopic: 'Garden' },
          widgetOutline: { concept: 'flow', steps: ['x'] },
        },
      ],
    });
    // The normal form is a fixed point: a normalized outline confirms unchanged.
    expect(parseOutlines(parsed.ok && parsed.value)).toEqual(parsed);
  });

  it('keeps a scene of a type it does not know (its content step decides), bounded', () => {
    const parsed = parseOutlines([outline({ type: 'video' })]);
    expect(parsed.ok && parsed.value[0]!.type).toBe('video');
  });

  it('keeps a quiz configuration only when the generator can use it as it is', () => {
    const quiz = (quizConfig: unknown) => {
      const parsed = parseOutlines([outline({ type: 'quiz', quizConfig })]);
      return parsed.ok ? parsed.value[0]!.quizConfig : 'refused';
    };
    const usable = { questionCount: 3, difficulty: 'easy', questionTypes: ['single', 'essay'] };
    expect(quiz(usable)).toEqual({
      questionCount: 3,
      difficulty: 'easy',
      questionTypes: ['single'],
    });
    expect(quiz({ ...usable, questionTypes: ['essay'] })).toBeUndefined();
    expect(quiz({ ...usable, difficulty: undefined })).toBeUndefined();
    expect(quiz({ ...usable, questionCount: 0 })).toBeUndefined();
    expect(quiz({ ...usable, questionCount: 101 })).toBeUndefined();
  });

  it('keeps at most 20 media requests per scene', () => {
    const media = Array.from({ length: 25 }, (_, i) => ({
      type: 'image',
      prompt: `p${i}`,
      elementId: `gen_img_${i}`,
    }));
    const parsed = parseOutlines([outline({ mediaGenerations: media })]);
    expect(parsed.ok && parsed.value[0]!.mediaGenerations).toHaveLength(20);
  });

  it("measures its size in UTF-8 bytes, the outline step's unit", () => {
    // Under the byte cap in UTF-16 code units, over it in UTF-8 bytes.
    const wide = '\u4e2d'.repeat(60_000);
    const outlines = Array.from({ length: 3 }, (_, i) =>
      outline({ id: `o${i}`, order: i, description: wide }),
    );
    expect(JSON.stringify(outlines).length).toBeLessThan(MAX_OUTLINE_JSON_BYTES);
    expect(parseOutlines(outlines)).toMatchObject({ ok: false, message: /bytes/ });
  });

  it('repairs a scene whose type is unusable instead of refusing the outline', () => {
    // Failures the live runs hit: the model wrote the intro scene with
    // mood/concept/keyBeats and no type, appended the design directive as
    // a scene (no teaching content to rebuild from), and once wrote a type
    // beyond the bounds. Every one rides in with usable neighbours.
    const noType = {
      id: 's1',
      title: 'مراحل دورة الماء',
      keyPoints: ['التبخر', 'التكثف'],
      order: 1,
    };
    const widgetTyped = {
      id: 's2',
      widgetType: 'animation-explainer',
      widgetOutline: { mood: 'فضولي' },
      title: 'مقدمة متحركة',
      keyPoints: ['a'],
      order: 2,
    };
    const overlong = outline({ id: 's3', type: 't'.repeat(65), title: 'خلاصة', order: 3 });
    const parsed = parseOutlines([noType, widgetTyped, overlong, 'junk']);
    expect(parsed.ok && parsed.value.map((o) => [o.id, o.type])).toEqual([
      ['s1', 'slide'],
      ['s2', 'interactive'],
      ['s3', 'slide'],
    ]);
    // The normal form is a fixed point: a repaired outline confirms unchanged.
    expect(parseOutlines(parsed.ok && parsed.value)).toEqual(parsed);
  });

  it('salvages the unwrapped animation-explainer draft on the last resort only', () => {
    // The second live failure: the intro scene streamed as the widget's own
    // mood/concept/keyBeats vocabulary with no scene wrapper, every attempt.
    // Strict repair drops it and refuses the outline.
    const draft = {
      id: 's1',
      mood: 'فضولي، خفيف، متلألئ',
      order: 1,
      concept: 'رحلة قطرة ماء واحدة تُرسم أمام العين: تتبخر بأشعة الشمس، ثم تعود إلى البحر',
      keyBeats: ['شمس تسخن البحر — قطرة تبدأ الصعود', 'أربع بطاقات: الشمس، البحر، السحاب'],
    };
    expect(parseOutlines([draft]).ok).toBe(false);

    // On the model's last roll the draft is rebuilt as the interactive scene
    // it meant to be: widget outline from the draft's vocabulary, title from
    // the concept's first sentence.
    const salvaged = normalizeSceneOutlines([draft], { lastResort: true });
    expect(salvaged.ok).toBe(true);
    if (salvaged.ok) {
      const scene = salvaged.value[0]!;
      expect(scene.type).toBe('interactive');
      expect(scene.widgetType).toBe('animation-explainer');
      expect(scene.title).toBe('رحلة قطرة ماء واحدة تُرسم أمام العين');
      expect(scene.widgetOutline).toMatchObject({
        mood: draft.mood,
        concept: draft.concept,
        keyBeats: draft.keyBeats,
      });
      // Strict mode is the confirm contract: the salvage normalizes unchanged.
      expect(parseOutlines(salvaged.value)).toEqual(salvaged);
    }

    // A bare widget sub-field without the vocabulary stays a fragment.
    expect(
      normalizeSceneOutlines([{ id: 's2', diagramType: 'flowchart' }], { lastResort: true }).ok,
    ).toBe(false);
  });

  it('recovers the bare MediaGeneration and the mixed drift stream on the last resort', () => {
    // The third live failure: the outline streamed the intro as the unwrapped
    // draft and the explained scene as a bare MediaGeneration — type 'image'
    // with a prompt and an element id. The strict pass kept the type-bearing
    // entry (a scene type no content step exists for, so the run died at the
    // first content step) and dropped the draft beside it: one usable scene,
    // the outline committed, and the intro was lost.
    const draft = {
      id: 's1',
      mood: 'فضولي، منعش، سماوي',
      order: 1,
      concept: 'قطرة ماء واحدة تتحرك في حلقة مغلقة: تصعد بخاراً، تتجمع سحاباً، ثم تعود مطراً',
      keyBeats: ['قطرة تسقط في البحر ثم تتجمد الصورة وسط السؤال', 'الحلقة الكاملة تُرسم ذاتها'],
    };
    const media = {
      id: 'm1',
      type: 'image',
      order: 2,
      prompt:
        'A clean educational diagram of the water cycle for children: ocean and a river at the bottom, sun rays causing evaporation.',
      elementId: 'gen_img_1',
      aspectRatio: '16:9',
    };

    const strictMix = normalizeSceneOutlines([draft, media]);
    expect(strictMix.ok).toBe(true);
    if (strictMix.ok) {
      expect(strictMix.value.length).toBe(1);
      expect(strictMix.value[0]!.type).toBe('image');
      expect(strictMix.dropped).toBe(1);
    }

    // The last resort reroutes both drift shapes: the draft to the
    // interactive scene it meant to be, the MediaGeneration to a slide
    // carrying the media request the media pass then generates.
    const salvaged = normalizeSceneOutlines([draft, media], { lastResort: true });
    expect(salvaged.ok).toBe(true);
    if (salvaged.ok) {
      expect(salvaged.value.length).toBe(2);
      expect(salvaged.value[1]!.type).toBe('slide');
      expect(salvaged.value[1]!.title).toBe(
        'A clean educational diagram of the water cycle for children',
      );
      expect(salvaged.value[1]!.mediaGenerations).toEqual([
        { type: 'image', prompt: media.prompt, elementId: 'gen_img_1', aspectRatio: '16:9' },
      ]);
      expect(salvaged.value[0]!.type).toBe('interactive');
      expect(salvaged.dropped).toBe(0);

      // Salvage output is a strict fixed point: the confirm pass
      // normalizes it unchanged.
      expect(normalizeSceneOutlines(salvaged.value)).toEqual(salvaged);
    }

    // A MediaGeneration lacking its element id is left to the strict
    // pass's judgement in both modes: recovering a media request no
    // element can show would be a placeholder nothing displays.
    const headless = { ...media, id: 'm2', elementId: '' };
    const headlessStrict = normalizeSceneOutlines([headless]);
    expect(headlessStrict.ok).toBe(true);
    if (headlessStrict.ok) {
      expect(headlessStrict.value.length).toBe(1);
      expect(headlessStrict.value[0]!.type).toBe('image');
      expect(headlessStrict.value[0]!.title).toBe('');
    }
  });

  it.each([
    ['a scene whose type and content are both absent', [{ id: 'o1', order: 1 }], /usable/],
    [
      'an overlong type and no teaching content',
      [{ id: 'o1', order: 1, type: 't'.repeat(65) }],
      /usable/,
    ],
    [
      'nothing but fragments',
      [
        { id: 'o1', order: 1, diagramType: 'flowchart' },
        { id: 'o2', order: 2, concept: 'orbit', palette: ['#0B4F6C'] },
        'junk',
      ],
      /usable/,
    ],
    ['an order out of bounds', [outline({ order: 10_001 })], /order/],
    ['a fractional order', [outline({ order: 1.5 })], /order/],
    ['a missing order', [outline({ order: null })], /order/],
    ['a missing id', [outline({ id: null })], /id/],
    ['a repeated order', [outline(), outline({ id: 'o2' })], /repeat an order/],
    ['a repeated id', [outline(), outline({ order: 2 })], /repeat an id/],
    ['no scenes', [], /1 to/],
    [
      'too many scenes',
      Array.from({ length: MAX_OUTLINE_SCENES + 1 }, (_, i) => outline({ id: `o${i}`, order: i })),
      /1 to/,
    ],
    [
      'too many bytes',
      Array.from({ length: 50 }, (_, i) =>
        outline({ id: `o${i}`, order: i, description: 'd'.repeat(12_000) }),
      ),
      /bytes/,
    ],
  ])('refuses %s', (_label, outlines, message) => {
    const parsed = parseOutlines(outlines);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.message).toMatch(message);
  });

  it('refuses a body over its byte limit, declared or not', async () => {
    const big = JSON.stringify({ requirement: 'x'.repeat(MAX_START_BODY_BYTES) });
    const declared = await readJsonBody(
      new Request('http://localhost/', { method: 'POST', body: big }),
      MAX_START_BODY_BYTES,
    );
    expect(declared).toMatchObject({ ok: false, status: 413 });
    const streamed = await readJsonBody(
      new Request('http://localhost/', {
        method: 'POST',
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(big));
            controller.close();
          },
        }),
        duplex: 'half',
      } as RequestInit),
      MAX_START_BODY_BYTES,
    );
    expect(streamed).toMatchObject({ ok: false, status: 413 });
    expect(
      await readJsonBody(
        new Request('http://localhost/', { method: 'POST', body: '{"a":1}' }),
        MAX_START_BODY_BYTES,
      ),
    ).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe('step retries', () => {
  const options = (refusalStatus: 400 | 500) => ({
    label: 'test',
    maxRetries: 2,
    refusalStatus,
    sleep: async () => undefined,
  });

  it('retries what the route answers with a 5xx or 429, and nothing it answers with a 4xx', async () => {
    const flaky = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    expect(await withRouteRetry(flaky, options(500))).toBe('ok');
    expect(flaky).toHaveBeenCalledTimes(2);

    const limited = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('slow down'), { statusCode: 429 }))
      .mockResolvedValue('ok');
    expect(await withRouteRetry(limited, options(500))).toBe('ok');

    const unauthorized = Object.assign(new Error('no'), { statusCode: 401 });
    const refused = vi.fn().mockRejectedValue(unauthorized);
    await expect(withRouteRetry(refused, options(500))).rejects.toBe(unauthorized);
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it('retries a refusal where the route answers it with a 500, not where it answers a 400', async () => {
    const refusal = new StepRefusal('generation-failed', 'empty');
    const content = vi.fn().mockRejectedValue(refusal);
    await expect(withRouteRetry(content, options(500))).rejects.toBe(refusal);
    expect(content).toHaveBeenCalledTimes(3);
    const narration = vi.fn().mockRejectedValue(refusal);
    await expect(withRouteRetry(narration, options(400))).rejects.toBe(refusal);
    expect(narration).toHaveBeenCalledTimes(1);
  });
});
