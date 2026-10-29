/**
 * The title guarantee: the outline prompts demand short learner-facing display
 * names, but an outline model sometimes answers with the image prompt itself
 * ("A cheerful children's cartoon poster of the water cycle") — and the
 * classroom then labels scenes with art direction, often in the wrong
 * language. Before the run commits its outline, titles that read like image
 * prompts are rewritten through one small model call in the teaching
 * language. A failed or malformed rewrite keeps the original titles: a wrong
 * title is cosmetic, a failed run is not.
 */
import { buildPrompt, PROMPT_IDS } from '@/lib/prompts';
import type { SceneOutline } from '@/lib/types/generation';

/**
 * Titles that name artwork, not the lesson. Deliberately narrow art-direction
 * nouns: "images" or "pictures" appear in real lesson titles ("Handling
 * Images with PIL"), while "illustration", "cartoon", "poster" in a title
 * almost always leaked from a media prompt.
 */
const PROMPT_TITLE_MARKER =
  /\b(illustrations?|cartoons?|posters?|infographics?|artwork|drawings?|clip ?art|renderings?|vector art|digital art)\b/i;

/** The indexes of outlines whose title reads like an image prompt. */
export function promptLikeTitleIndexes(outlines: readonly SceneOutline[]): number[] {
  return outlines.flatMap((outline, index) =>
    PROMPT_TITLE_MARKER.test(outline.title) ? [index] : [],
  );
}

/** The retitle call: the built prompt in, the model's text out. */
export type TitleCallFn = (systemPrompt: string, userPrompt: string) => Promise<string>;

export interface RetitleInput {
  languageDirective?: string;
  /** The raw run requirement: the topic the new titles must name. */
  requirement: string;
}

/** A rewritten title the model may keep: short, present, no art direction. */
function acceptableTitle(title: unknown): title is string {
  return typeof title === 'string' && title.trim().length > 0 && title.length <= 60 && !PROMPT_TITLE_MARKER.test(title);
}

/**
 * Rewrite the prompt-like titles through one model call; every other title
 * (and every outline when the call fails or names nothing usable) stays
 * exactly as generated.
 */
export async function rewritePromptLikeTitles(
  outlines: readonly SceneOutline[],
  input: RetitleInput,
  aiCall: TitleCallFn,
  log?: { warn(message: string, meta?: unknown): void },
): Promise<SceneOutline[]> {
  const flagged = promptLikeTitleIndexes(outlines);
  if (flagged.length === 0) return [...outlines];

  const prompt = buildPrompt(PROMPT_IDS.OUTLINE_TITLES, {
    languageDirective: input.languageDirective ?? '',
    requirement: input.requirement,
    titlesJson: JSON.stringify(
      flagged.map((index) => {
        const outline = outlines[index]!;
        return {
          id: outline.id,
          type: outline.type,
          title: outline.title,
          ...(outline.description ? { description: outline.description } : {}),
          ...(outline.keyPoints.length > 0 ? { keyPoints: outline.keyPoints } : {}),
        };
      }),
      null,
      2,
    ),
  });
  if (!prompt) return [...outlines];

  try {
    const text = await aiCall(prompt.system, prompt.user);
    // Tolerate a code fence around the JSON object.
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const parsed: unknown = JSON.parse(json);
    const titles = (parsed as { titles?: unknown }).titles;
    if (!Array.isArray(titles)) throw new Error('no titles array');
    const byId = new Map(
      titles
        .filter((entry): entry is { id: string; title: string } => {
          const candidate = entry as { id?: unknown; title?: unknown };
          return typeof candidate.id === 'string' && typeof candidate.title === 'string';
        })
        .map((entry) => [entry.id, entry.title]),
    );
    let rewritten = 0;
    const result = outlines.map((outline) => {
      const title = byId.get(outline.id);
      if (title === undefined || !acceptableTitle(title)) return outline;
      rewritten += 1;
      return { ...outline, title };
    });
    if (rewritten === 0) throw new Error('no title survived validation');
    log?.warn?.(`rewrote ${rewritten} image-prompt-like outline title(s)`, {
      flagged: flagged.length,
    });
    return result;
  } catch (error) {
    log?.warn?.('outline title rewrite failed; keeping the generated titles', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [...outlines];
  }
}
