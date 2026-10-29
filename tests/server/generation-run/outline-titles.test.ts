import { describe, expect, it } from 'vitest';

import type { SceneOutline } from '@/lib/types/generation';

import {
  promptLikeTitleIndexes,
  rewritePromptLikeTitles,
  type TitleCallFn,
} from '@/lib/server/generation/run/outline-titles';

/** A minimal outline of a given type, with the fields the rewrite reads. */
function outlineOf(
  id: string,
  type: SceneOutline['type'],
  overrides: Partial<SceneOutline> = {},
): SceneOutline {
  return {
    id,
    type,
    title: `Scene ${id}`,
    description: '',
    keyPoints: [],
    order: 0,
    ...overrides,
  };
}

/** The four titles the sandbox's outline model actually produced. */
function sandboxOutline(): SceneOutline[] {
  return [
    outlineOf('p0', 'interactive', { title: 'قطرة ماء كبيرة مبتسمة ترتفع من موجة بحر' }),
    outlineOf('p1', 'interactive', { title: 'تظهر ثلاث بطاقات ملوّنة' }),
    outlineOf('cover', 'slide', { title: 'رحلة قطرة ماء واحدة من البحر إلى السحابة إلى المطر' }),
    outlineOf('s2', 'slide', { title: "A cheerful children's cartoon poster of the water cycle" }),
    outlineOf('s3', 'slide', { title: "A simple children's illustration of evaporation" }),
    outlineOf('s4', 'slide', { title: 'A gentle animated illustration of condensation' }),
    outlineOf('s5', 'slide', { title: 'A cheerful children\'s illustration of rainfall' }),
  ];
}

describe('promptLikeTitleIndexes', () => {
  it('flags the art-direction titles, not the learner-facing ones', () => {
    const flagged = promptLikeTitleIndexes(sandboxOutline());
    expect(flagged).toEqual([3, 4, 5, 6]);
  });

  it('does not flag real lesson titles that merely mention technology words', () => {
    const outlines = [
      outlineOf('s1', 'slide', { title: 'Handling Images with PIL' }),
      outlineOf('s2', 'slide', { title: 'تصميم واجهة المستخدم' }),
    ];
    expect(promptLikeTitleIndexes(outlines)).toEqual([]);
  });
});

describe('rewritePromptLikeTitles', () => {
  const aiCall: TitleCallFn = async (system, user) => {
    expect(system).toContain('DISPLAY NAME');
    expect(user).toContain('علمني درسًا عن دورة الماء');
    expect(user).toContain('"id": "s3"');
    return JSON.stringify({
      titles: [
        { id: 's2', title: 'دورة الماء' },
        { id: 's3', title: 'التبخر' },
        { id: 's4', title: 'A gentle animated illustration of condensation' },
        { id: 'unknown', title: 'مقصول' },
        { id: 's5', title: '' },
      ],
    });
  };

  it('rewrites only the flagged titles, keeping the validated ones', async () => {
    const result = await rewritePromptLikeTitles(
      sandboxOutline(),
      { requirement: 'علمني درسًا عن دورة الماء' },
      aiCall,
    );
    expect(result.map((o) => o.title)).toEqual([
      'قطرة ماء كبيرة مبتسمة ترتفع من موجة بحر',
      'تظهر ثلاث بطاقات ملوّنة',
      'رحلة قطرة ماء واحدة من البحر إلى السحابة إلى المطر',
      'دورة الماء',
      'التبخر',
      // A rewrite that still reads like an image prompt is rejected.
      'A gentle animated illustration of condensation',
      // An empty rewrite is rejected.
      "A cheerful children's illustration of rainfall",
    ]);
  });

  it('keeps every title when the model call fails', async () => {
    const original = sandboxOutline();
    const result = await rewritePromptLikeTitles(
      original,
      { requirement: 'X' },
      async () => {
        throw new Error('refused');
      },
    );
    expect(result.map((o) => o.title)).toEqual(original.map((o) => o.title));
  });

  it('keeps every title when the answer is not the expected JSON', async () => {
    const original = sandboxOutline();
    const garbage: TitleCallFn = async () => 'Sure! Here are better titles for you.';
    expect((await rewritePromptLikeTitles(original, { requirement: 'X' }, garbage)).map((o) => o.title)).toEqual(
      original.map((o) => o.title),
    );
  });

  it('tolerates a code fence around the JSON object', async () => {
    const result = await rewritePromptLikeTitles(
      sandboxOutline(),
      { requirement: 'X' },
      async () =>
        '```json\n{"titles":[{"id":"s2","title":"دورة الماء"}]}\n```',
    );
    expect(result.find((o) => o.id === 's2')!.title).toBe('دورة الماء');
  });

  it('is a no-op when nothing is flagged', async () => {
    const outlines = [outlineOf('s1', 'slide'), outlineOf('s2', 'quiz')];
    let calls = 0;
    const result = await rewritePromptLikeTitles(
      outlines,
      { requirement: 'X' },
      async () => {
        calls += 1;
        return '{}';
      },
    );
    expect(calls).toBe(0);
    expect(result).toEqual(outlines);
  });
});
