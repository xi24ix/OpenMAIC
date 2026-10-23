import { expect, it } from 'vitest';
import {
  FALLBACK_DESIGN_DIRECTIVE,
  formatDesignDirective,
  normalizeDesignDirective,
} from '@openmaic/generation';

it('normalizes a complete directive: validates hex colors and the personality enum', () => {
  const directive = normalizeDesignDirective({
    concept: 'recursion as russian nesting dolls',
    palette: ['#0A0A0A', ' #f5b942 ', '#ZZZZZZ'],
    background: 'dark',
    motionPersonality: 'PLAYFUL',
  });

  expect(directive).toEqual({
    concept: 'recursion as russian nesting dolls',
    palette: ['#0a0a0a', '#f5b942'],
    background: 'dark',
    motionPersonality: 'playful',
  });
});

it('maps style aliases to the closest supported values', () => {
  const directive = normalizeDesignDirective({
    concept: 'temporal',
    palette: ['#3D8BFF'],
    background: 'black',
    motionPersonality: 'bouncy',
  });

  expect(directive?.background).toBe('dark');
  expect(directive?.motionPersonality).toBe('playful');
});

it('returns null on unusable shapes', () => {
  expect(normalizeDesignDirective(null)).toBeNull();
  expect(normalizeDesignDirective('dark cinematic')).toBeNull();
  expect(normalizeDesignDirective({ palette: 'not-an-array' })).toBeNull();
  expect(normalizeDesignDirective({ palette: [] })).toBeNull();
});

it('formats a directive into the exact guidance block every scene receives', () => {
  const formatted = formatDesignDirective({
    concept: 'a workshop control room',
    palette: ['#101010', '#f5b942', '#3d8bff', '#9c9c9c', '#ececec'],
    background: 'light',
    motionPersonality: 'calm',
  });

  expect(formatted).toContain('- Visual concept: a workshop control room');
  expect(formatted).toContain('- Palette (use ONLY these hexes):');
  expect(formatted).toContain('- Background mode: light');
  expect(formatted).toContain('- Motion personality: calm');
});

it('formats a missing directive as model guidance, and the fallback directive non-empty', () => {
  expect(formatDesignDirective(null)).toContain('declare ONE coherent design system yourself');
  // `formatDesignDirective(FALLBACK)` stays non-empty for placeholder interpolation.
  expect(formatDesignDirective(FALLBACK_DESIGN_DIRECTIVE).length).toBeGreaterThan(0);
});
