/**
 * Per-course visual design directive: the shared design language every scene
 * of one course generates under (palette, mood, motion personality). Inferred
 * once by the outline stage from the requirement, materials and research
 * context, then threaded through slide, quiz and widget content generation so
 * a course never again defaults to one shared "PowerPoint blue" look.
 */

export interface DesignDirective {
  /** One line describing the intended visual mood, e.g. "cinematic dark-mode physics lab". */
  concept: string;
  /**
   * 2-5 hex colors, first entry intended as the base/background or darkest
   * neutral, last as the accent. All scene generation uses only these.
   */
  palette: string[];
  /**
   * Background lean: `dark` (near-black canvas, tech/AI/storytelling),
   * `paper` (warm cream, kids/language/k-12), or `light` (plain white,
   * medicine/law/finance).
   */
  background: 'dark' | 'paper' | 'light';
  /**
   * Tween voice for motion: playful / energetic / calm / cinematic. Widgets
   * and (when supported) slide animation cues read it.
   */
  motionPersonality: 'playful' | 'energetic' | 'calm' | 'cinematic';
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const PERSONALITIES: DesignDirective['motionPersonality'][] = [
  'playful',
  'energetic',
  'calm',
  'cinematic',
];
const PERSONALITY_ALIASES: Record<string, DesignDirective['motionPersonality']> = {
  premium: 'calm',
  storytelling: 'calm',
  bouncy: 'playful',
  dramatic: 'cinematic',
};
const BACKGROUND_ALIASES: Record<string, DesignDirective['background']> = {
  black: 'dark',
  night: 'dark',
  cream: 'paper',
  warm: 'paper',
  white: 'light',
  bright: 'light',
};

function clampText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

/**
 * Validate and normalize a model-provided design directive. Returns null when
 * the value is absent or wholly unusable (callers fall back to their own
 * defaults rather than failing generation over styling).
 */
export function normalizeDesignDirective(
  value: unknown,
): DesignDirective | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;

  const concept = clampText(raw.concept, 200);
  const conceptFromStyle =
    concept ??
    (typeof raw.style === 'string' && raw.style.trim()
      ? clampText(raw.style, 200)
      : undefined);

  const palette = Array.isArray(raw.palette)
    ? raw.palette
        .filter(
          (entry): entry is string => typeof entry === 'string' && HEX_COLOR_RE.test(entry.trim()),
        )
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry, index, list) => list.indexOf(entry) === index)
        .slice(0, 5)
    : [];

  const rawBackground =
    typeof raw.background === 'string' ? raw.background.trim().toLowerCase() : '';
  const background: DesignDirective['background'] | undefined =
    rawBackground === 'dark' || rawBackground === 'paper' || rawBackground === 'light'
      ? rawBackground
      : BACKGROUND_ALIASES[rawBackground];

  const rawPersonality =
    typeof raw.motionPersonality === 'string' ? raw.motionPersonality.trim().toLowerCase() : '';
  const personality = PERSONALITIES.find((candidate) => candidate === rawPersonality);
  const personalityAlias = PERSONALITY_ALIASES[rawPersonality];

  const directive: DesignDirective = {
    ...(conceptFromStyle ? { concept: conceptFromStyle } : { concept: '' }),
    ...(palette.length > 0 ? { palette } : { palette: [] }),
    ...(background ? { background } : { background: 'dark' }),
    ...(personality || personalityAlias
      ? { motionPersonality: (personality ?? personalityAlias)! }
      : { motionPersonality: 'calm' }),
  };

  // Wholly unusable (nothing but defaults): treat as absent so the prompt
  // falls back to self-selection instead of asserting an empty directive.
  if (!conceptFromStyle && palette.length === 0 && !background && !personality && !personalityAlias) {
    return null;
  }
  return directive;
}

/** The fallback used when the outline stage produced no usable directive. */
export const FALLBACK_DESIGN_DIRECTIVE: DesignDirective = {
  concept: '',
  palette: [],
  background: 'dark',
  motionPersonality: 'calm',
};
/**
 * Render a directive into the text block scene prompts consume. Always
 * non-empty: without a directive it instructs the model to design one
 * coherent system itself, appended by the scene-generation context.
 */
export function formatDesignDirective(directive: DesignDirective | null | undefined): string {
  if (!directive) {
    return 'None. Before writing any scene: declare ONE coherent design system yourself (background mode, text color, one accent hue, motion personality) that suits the topic, and apply it consistently across every scene you generate this course.';
  }
  const lines: string[] = [];
  if (directive.concept) lines.push(`- Visual concept: ${directive.concept}`);
  if (directive.palette.length > 0) {
    lines.push(`- Palette (use ONLY these hexes): ${directive.palette.join(', ')}`);
  }
  if (lines.length === 0) {
    lines.push('- No extras requested — keep the course coherent with a single system.');
  }
  lines.push(`- Background mode: ${directive.background}`);
  lines.push(`- Motion personality: ${directive.motionPersonality}`);
  return lines.join('\n');
}
