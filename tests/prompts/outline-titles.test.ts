import { describe, expect, test } from 'vitest';

import { buildPrompt, PROMPT_IDS } from '@/lib/prompts';

describe('the outline-titles prompt', () => {
  test('renders every variable and leaves no braces', () => {
    const p = buildPrompt(PROMPT_IDS.OUTLINE_TITLES, {
      languageDirective: 'Deliver the entire lesson in simplified Arabic.',
      requirement: 'علمني دورة الماء',
      titlesJson: '[{"id":"scene_4","title":"A cheerful children\'s cartoon poster"}]',
    });
    expect(p).not.toBeNull();
    expect(p!.user).toContain('Deliver the entire lesson in simplified Arabic.');
    expect(p!.user).toContain('علمني دورة الماء');
    expect(p!.user).toContain('A cheerful children\'s cartoon poster');
    expect(p!.system).not.toContain('{{');
    expect(p!.user).not.toContain('{{');
  });

  test('demands learner-facing names in the teaching language, never art direction', () => {
    const p = buildPrompt(PROMPT_IDS.OUTLINE_TITLES, {
      languageDirective: 'Arabic',
      requirement: 'X',
      titlesJson: '[]',
    });
    expect(p!.system).toContain('DISPLAY NAME');
    expect(p!.system).toContain('teaching language');
    expect(p!.system).toContain('NEVER write an image description');
    expect(p!.system).toContain('"titles"');
  });
});
