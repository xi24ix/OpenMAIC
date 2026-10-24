/**
 * One normalizer for scene outlines, applied to what the outline step
 * produced and to an outline a caller edits and confirms, so an outline the
 * step generated is always confirmable unchanged.
 *
 * It is lenient where a model is loose and strict only where the pipeline
 * depends on it: the number of scenes, the size, each scene's id and order,
 * and that a scene has a type. That type check runs after a repair pass,
 * because the outline stage's model sometimes writes a scene whose `type`
 * is absent, blank or over-long, or drops a non-scene fragment (a
 * design-directive object, an unfinished draft) into the `outlines` array;
 * refusing the outline such an entry rides in would kill a good one. The
 * repair routes a scene by what it carries — a recognised `widgetType`
 * makes it `interactive`, teaching content (title, description, keyPoints)
 * makes it a `slide`, an entry with neither is a fragment the outline
 * drops — and if that drops every entry the outline is still refused.
 *
 * On the model's last roll (`lastResort`) the repair is one step stronger,
 * at the call site's discretion: an entry carrying the animation-explainer
 * vocabulary the model sometimes writes unwrapped (`mood`/`concept`/
 * `keyBeats`, no wrapper) is rebuilt as its `interactive` scene instead of
 * dropped — one reconstructed intro beats a run that never starts.
 *
 * The type is still not checked against the known ones: as in the browser,
 * a scene of a type no content path supports fails at its own content step,
 * not the outline. A `null` member is treated as absent; an optional member
 * of the wrong shape is dropped (and so are the items of a list that are
 * not what the list holds); members the schema does not know are not
 * carried over. Normalizing a normalized outline changes nothing.
 */
import { WIDGET_TYPES } from '@openmaic/dsl';

import type { SceneOutline } from '@/lib/types/generation';

/** The most scenes an outline may plan (the outline step stops reading the model there). */
export const MAX_OUTLINE_SCENES = 100;
/**
 * The most an outline may be, in UTF-8 bytes of JSON: the outline step's own
 * read cap on the model's output, in the same unit.
 */
export const MAX_OUTLINE_JSON_BYTES = 512 * 1024;
/** The bounds a confirmed outline keeps its scenes within. */
const MAX_TYPE_CHARS = 64;
const MAX_ORDER = 10_000;
const MAX_QUESTION_COUNT = 100;
const MAX_MEDIA_GENERATIONS = 20;

const QUESTION_TYPES = ['single', 'multiple', 'text'] as const;

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export type NormalizedOutlines =
  | { ok: true; value: SceneOutline[] }
  | { ok: false; message: string };

/** How much of the model's mess the repair pass cleans. */
export interface NormalizeOptions {
  /**
   * Also rebuild unwrapped animation-explainer drafts (`mood`/`concept`/
   * `keyBeats` with no scene wrapper) instead of dropping them. For the
   * caller's last roll only — a confirm always normalizes in the strict
   * mode the step committed.
   */
  lastResort?: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function texts(value: unknown, { nonEmpty }: { nonEmpty: boolean }): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (item): item is string => typeof item === 'string' && (!nonEmpty || item.trim() !== ''),
  );
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Drop the members that are undefined (or empty objects of optional configs). */
function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** A JSON value with every `null` member and item removed. */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => item !== null).map(withoutNulls);
  const object = record(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.entries(object)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([key, v]) => [key, withoutNulls(v)]),
  );
}

function mediaGenerations(value: unknown): SceneOutline['mediaGenerations'] {
  if (!Array.isArray(value)) return undefined;
  // At most so many requests; the rest go the way invalid items go.
  return value.slice(0, MAX_MEDIA_GENERATIONS).flatMap((item) => {
    const media = record(item);
    const type = oneOf(media?.type, ['image', 'video'] as const);
    const prompt = text(media?.prompt);
    const elementId = text(media?.elementId);
    if (!media || !type || prompt === undefined || !elementId) return [];
    return [
      defined({
        type,
        prompt,
        elementId,
        aspectRatio: oneOf(media.aspectRatio, ['16:9', '4:3', '1:1', '9:16'] as const),
        style: text(media.style),
      }),
    ];
  });
}

/**
 * A quiz configuration the content generator can use as it is, or none at
 * all (the generator then applies its defaults): every member present and
 * recognised, a question count within bounds, at least one question type.
 */
function quizConfig(value: unknown): SceneOutline['quizConfig'] {
  const quiz = record(value);
  if (!quiz) return undefined;
  const questionCount = finite(quiz.questionCount);
  const difficulty = oneOf(quiz.difficulty, ['easy', 'medium', 'hard'] as const);
  const questionTypes = Array.isArray(quiz.questionTypes)
    ? quiz.questionTypes.flatMap((type) => {
        const known = oneOf(type, QUESTION_TYPES);
        return known ? [known] : [];
      })
    : [];
  if (
    questionCount === undefined ||
    !Number.isInteger(questionCount) ||
    questionCount < 1 ||
    questionCount > MAX_QUESTION_COUNT ||
    !difficulty ||
    questionTypes.length === 0
  ) {
    return undefined;
  }
  return { questionCount, difficulty, questionTypes };
}

function interactiveConfig(value: unknown): SceneOutline['interactiveConfig'] {
  const config = record(value);
  if (!config) return undefined;
  return defined({
    conceptName: text(config.conceptName),
    conceptOverview: text(config.conceptOverview),
    designIdea: text(config.designIdea),
    subject: text(config.subject),
  }) as SceneOutline['interactiveConfig'];
}

function pblConfig(value: unknown): SceneOutline['pblConfig'] {
  const config = record(value);
  if (!config) return undefined;
  return defined({
    projectTopic: text(config.projectTopic),
    projectDescription: text(config.projectDescription),
    targetSkills: texts(config.targetSkills, { nonEmpty: true }),
    issueCount: finite(config.issueCount),
    scenarioRoleplay:
      typeof config.scenarioRoleplay === 'boolean' ? config.scenarioRoleplay : undefined,
    scenarioBrief: text(config.scenarioBrief),
  }) as SceneOutline['pblConfig'];
}

class OutlineRefused extends Error {}

/**
 * Teaching content a routed scene can be generated from. The evidence a
 * type-less scene needs for the repair to keep it.
 */
function hasTeachingContent(raw: Record<string, unknown>): boolean {
  const title = text(raw.title)?.trim();
  const description = text(raw.description)?.trim();
  return !!title || !!description || (texts(raw.keyPoints, { nonEmpty: true })?.length ?? 0) > 0;
}

/**
 * An animation-explainer the model wrote unwrapped — the widget's own
 * `mood`/`concept`/`keyBeats` vocabulary with no `type`, `widgetType` or
 * scene wrapper — rebuilt as the interactive scene it meant to be. The
 * title, which such a draft never carries, is the concept's first sentence
 * (the first beat when there is no concept), long enough to name the scene
 * and short enough to stay one.
 */
function animationExplainerDraft(raw: Record<string, unknown>): Record<string, unknown> | null {
  const beats = texts(raw.keyBeats, { nonEmpty: true });
  if (!beats || beats.length === 0) return null;
  const concept = text(raw.concept)?.trim() || undefined;
  const mood = text(raw.mood)?.trim() || undefined;
  const source = (concept ?? beats[0] ?? '').trim();
  const title = source.split(/[.!:؟?؛\n]/)[0]!.trim().slice(0, 60);
  return {
    ...raw,
    type: 'interactive',
    widgetType: 'animation-explainer',
    ...(title ? { title } : {}),
    widgetOutline: defined({ mood, concept, keyBeats: beats }),
  };
}

/**
 * The scene object in `value`, as far as it can carry a usable `type`, or
 * null when it is a fragment to drop. A usable type passes through; a
 * missing, blank, over-long or non-string one is repaired by routing the
 * scene on what it does carry (`WIDGET_TYPES` → `interactive`, teaching
 * content → `slide`), and an entry with neither is not a scene. With
 * `lastResort` the unwrapped animation-explainer draft is rebuilt instead
 * of dropped.
 */
function usableScene(value: unknown, lastResort: boolean): Record<string, unknown> | null {
  const raw = record(value);
  if (!raw) return null;
  const type = text(raw.type);
  if (type && type.trim() !== '' && type.length <= MAX_TYPE_CHARS) return raw;
  if (lastResort) {
    const draft = animationExplainerDraft(raw);
    if (draft) return draft;
  }
  return hasTeachingContent(raw) || oneOf(raw.widgetType, WIDGET_TYPES)
    ? { ...raw, type: oneOf(raw.widgetType, WIDGET_TYPES) ? 'interactive' : 'slide' }
    : null;
}

function sceneOutline(value: unknown, index: number): SceneOutline {
  const at = `outlines[${index}]`;
  const raw = record(value);
  if (!raw) throw new OutlineRefused(`${at} must be an object`);
  const id = text(raw.id);
  if (!id || !id.trim()) throw new OutlineRefused(`${at}.id must be a non-empty string`);
  const type = text(raw.type);
  if (!type || !type.trim() || type.length > MAX_TYPE_CHARS) {
    throw new OutlineRefused(
      `${at}.type must be a non-empty string of at most ${MAX_TYPE_CHARS} characters`,
    );
  }
  const order = raw.order;
  if (typeof order !== 'number' || !Number.isInteger(order) || order < 0 || order > MAX_ORDER) {
    throw new OutlineRefused(`${at}.order must be an integer from 0 to ${MAX_ORDER}`);
  }
  const widgetOutline = record(raw.widgetOutline);
  return defined({
    id,
    type: type as SceneOutline['type'],
    title: text(raw.title) ?? '',
    description: text(raw.description) ?? '',
    keyPoints: texts(raw.keyPoints, { nonEmpty: true }) ?? [],
    teachingObjective: text(raw.teachingObjective),
    estimatedDuration: finite(raw.estimatedDuration),
    order,
    languageNote: text(raw.languageNote),
    suggestedImageIds: texts(raw.suggestedImageIds, { nonEmpty: true }),
    mediaGenerations: mediaGenerations(raw.mediaGenerations),
    quizConfig: quizConfig(raw.quizConfig),
    interactiveConfig: interactiveConfig(raw.interactiveConfig),
    pblConfig: pblConfig(raw.pblConfig),
    widgetType: oneOf(raw.widgetType, WIDGET_TYPES),
    widgetOutline: widgetOutline
      ? (withoutNulls(widgetOutline) as SceneOutline['widgetOutline'])
      : undefined,
  }) as SceneOutline;
}

/**
 * The outline in its normal form, or why it cannot be one: not 1 to
 * {@link MAX_OUTLINE_SCENES} scenes, over {@link MAX_OUTLINE_JSON_BYTES},
 * a scene without a usable id or order (ids and orders unique), or an
 * array whose every entry is a fragment the type repair dropped. With
 * `lastResort` the repair also rebuilds unwrapped animation-explainer
 * drafts — the call the model's last roll takes.
 */
export function normalizeSceneOutlines(
  value: unknown,
  { lastResort = false }: NormalizeOptions = {},
): NormalizedOutlines {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_OUTLINE_SCENES) {
    return {
      ok: false,
      message: `outlines must be an array of 1 to ${MAX_OUTLINE_SCENES} scene outlines`,
    };
  }
  const tooLarge = {
    ok: false as const,
    message: `outlines may be at most ${MAX_OUTLINE_JSON_BYTES} bytes of JSON`,
  };
  if (jsonBytes(value) > MAX_OUTLINE_JSON_BYTES) return tooLarge;
  let outlines: SceneOutline[];
  try {
    // Index positions are the raw array's, used directly in a refusal's
    // location, so a dropped fragment never renumbers another entry.
    outlines = value.flatMap((item, index) => {
      const scene = usableScene(item, lastResort);
      return scene ? [sceneOutline(scene, index)] : [];
    });
  } catch (error) {
    if (error instanceof OutlineRefused) return { ok: false, message: error.message };
    throw error;
  }
  if (outlines.length === 0) {
    return {
      ok: false,
      message: 'outlines holds no usable scene: every entry is a fragment (no type, no teaching content) or not a scene object',
    };
  }
  if (new Set(outlines.map((outline) => outline.id)).size !== outlines.length) {
    return { ok: false, message: 'outlines must not repeat an id' };
  }
  if (new Set(outlines.map((outline) => outline.order)).size !== outlines.length) {
    return { ok: false, message: 'outlines must not repeat an order' };
  }
  // The normal form is measured too, so what normalizing yields always
  // normalizes again.
  if (jsonBytes(outlines) > MAX_OUTLINE_JSON_BYTES) return tooLarge;
  return { ok: true, value: outlines };
}
