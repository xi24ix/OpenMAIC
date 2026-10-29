import { describe, expect, it } from 'vitest';

import type { Action } from '@/lib/types/action';

import { capSpeechActions } from '@/lib/server/generation/steps/scene-actions';

function speech(text: string): Action {
  return { id: `a-${text}`, type: 'speech', text };
}

function spotlight(elementId: string): Action {
  return { id: `sp-${elementId}`, type: 'spotlight', elementId };
}

describe('capSpeechActions', () => {
  it('keeps an action list at or under the cap unchanged', () => {
    const actions = [speech('مرحبا'), spotlight('e1'), speech('الفكرة'), spotlight('e2'), speech('نختم')];
    const result = capSpeechActions(actions, 'slide');
    expect(result).toEqual(actions);
  });

  it('drops the middle elaborations of a talkative slide, keeping open and close', () => {
    const actions = [
      speech('مرحبًا بكم'),
      spotlight('e1'),
      speech('الشرح ٢'),
      speech('الشرح ٣'),
      speech('الشرح ٤'),
      speech('الشرح ٥'),
      speech('والنهاية'),
      spotlight('e2'),
    ];
    const result = capSpeechActions(actions, 'slide');
    const speeches = result.filter((a) => a.type === 'speech') as { text: string }[];
    expect(speeches.map((a) => a.text)).toEqual(['مرحبًا بكم', 'الشرح ٢', 'والنهاية']);
    // The visual actions all survive, in order.
    expect(result.filter((a) => a.type === 'spotlight')).toHaveLength(2);
  });

  it('gives widget scenes a wider ration and keeps the opening beats', () => {
    const actions = Array.from({ length: 7 }, (_, i) => speech(`كلام ${i}`));
    const result = capSpeechActions(actions, 'interactive');
    expect(result).toHaveLength(4);
    expect(result[0]!.type).toBe('speech');
    expect(result[3]!.type).toBe('speech');
  });

  it('never drops non-speech actions, so ordering rules stay valid', () => {
    const actions = [
      speech('١'),
      speech('٢'),
      speech('٣'),
      speech('٤'),
      speech('٥'),
      { id: 'd1', type: 'discussion', topic: 'سؤال للصف' } as Action,
    ];
    const result = capSpeechActions(actions, 'slide');
    expect(result[result.length - 1]!.type).toBe('discussion');
    expect(result.filter((a) => a.type === 'speech')).toHaveLength(3);
  });

  it('applies the quiz ration', () => {
    const actions = [speech('١'), speech('٢'), speech('٣'), speech('٤'), speech('٥')];
    expect(capSpeechActions(actions, 'pbl')).toHaveLength(4);
    expect(capSpeechActions(actions, 'quiz')).toHaveLength(3);
  });
});
