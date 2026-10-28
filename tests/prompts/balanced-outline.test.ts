import { describe, expect, test } from 'vitest';

import { buildPrompt, PROMPT_IDS } from '@/lib/prompts';

const BASE = {
  requirement: 'X',
  pdfContent: 'None',
  availableImages: 'None',
  researchContext: 'None',
  teacherContext: '',
  userProfile: '',
  hasSourceImages: false,
  imageEnabled: true,
  videoEnabled: false,
  mediaEnabled: true,
};

describe('balanced interactive outline prompt', () => {
  test('renders the scene-count target and leaves no braces', () => {
    const p = buildPrompt(PROMPT_IDS.INTERACTIVE_OUTLINES, {
      ...BASE,
      sceneCountTarget: 'Plan about 8 scenes in total (never more).',
    });
    expect(p).not.toBeNull();
    expect(p!.user).toContain('Plan about 8 scenes in total (never more).');
    expect(p!.user).not.toContain('{{sceneCountTarget}}');
    expect(p!.system).not.toContain('{{');
    expect(p!.user).not.toContain('{{');
  });

  test('omits the scene-count section when the caller passes none', () => {
    const p = buildPrompt(PROMPT_IDS.INTERACTIVE_OUTLINES, { ...BASE });
    expect(p).not.toBeNull();
    expect(p!.user).not.toContain('sceneCountTarget');
    expect(p!.user).not.toMatch(/\{\{/);
  });

  test('quiz scenes are first-class; the intro is optional', () => {
    const p = buildPrompt(PROMPT_IDS.INTERACTIVE_OUTLINES, {
      ...BASE,
      sceneCountTarget: 'Plan about 8 scenes in total (never more).',
    });
    expect(p!.system).toContain('Quiz Scenes (assessment)');
    expect(p!.system).toContain('Intro Scene (optional cinematic cold open)');
    expect(p!.system).not.toContain('Intro Scene (MANDATORY');
    expect(p!.user).toContain('~50% slide scenes');
  });
});
