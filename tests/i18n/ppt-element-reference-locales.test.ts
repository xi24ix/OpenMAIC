import { describe, expect, it } from 'vitest';
import arSA from '@/lib/i18n/locales/ar-SA.json';
import enUS from '@/lib/i18n/locales/en-US.json';

const locales = { arSA, enUS };
const coursewareInstructions: Record<keyof typeof locales, string> = {
  arSA: 'انقر على عنصر · Esc للخروج',
  enUS: 'Click an element · Esc to exit',
};
const clearLabels: Record<keyof typeof locales, string> = {
  arSA: 'إزالة الإشارة',
  enUS: 'Remove reference',
};
const referenceKeys = [
  'button',
  'unavailable',
  'instruction',
  'fallback',
  'clear',
  'whiteboardChanged',
  'summary.noText',
  'summary.emptyContent',
  'summary.code',
  'summary.line',
  'summary.imageMetadata',
  'summary.videoMetadata',
  'summary.audioMetadata',
] as const;

const elementTypeKeys = [
  'text',
  'image',
  'shape',
  'line',
  'chart',
  'table',
  'latex',
  'video',
  'audio',
  'code',
] as const;

function getValue(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

describe('courseware element reference locale coverage', () => {
  it.each(Object.entries(coursewareInstructions))(
    '%s describes the unified courseware picker rather than a slide-only picker',
    (code, instruction) => {
      expect(locales[code as keyof typeof locales].chat.elementReference.instruction).toBe(
        instruction,
      );
    },
  );

  it.each(Object.entries(locales))('%s defines every user-facing reference label', (code, data) => {
    for (const key of referenceKeys) {
      const value = getValue(data.chat.elementReference, key);
      expect(typeof value, `${code} missing chat.elementReference.${key}`).toBe('string');
      expect(
        (value as string).trim(),
        `${code} has an empty chat.elementReference.${key}`,
      ).not.toBe('');
    }

    for (const key of elementTypeKeys) {
      const value = getValue(data.edit.element, key);
      expect(typeof value, `${code} missing edit.element.${key}`).toBe('string');
      expect((value as string).trim(), `${code} has an empty edit.element.${key}`).not.toBe('');
    }

    expect(data.chat.elementReference.clear).toBe(clearLabels[code as keyof typeof locales]);
    expect(typeof data.edit.sceneType.interactive).toBe('string');
    expect(data.edit.sceneType.interactive.trim()).not.toBe('');
  });
});
