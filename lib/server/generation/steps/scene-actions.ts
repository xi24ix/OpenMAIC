/**
 * Scene actions: generate the playback actions (speech, spotlights, ...) for
 * one scene from its outline and content, with the course context (the
 * scene's place among all outlines and the speeches of the scenes before it),
 * and assemble the complete scene. The logic of 1.1.x's
 * POST /api/generate/scene-actions.
 */
import { callLLM } from '@/lib/ai/llm';
import {
  generateSceneActions as generateActions,
  buildCompleteScene,
  buildVisionUserContent,
  type SceneGenerationContext,
  type AgentInfo,
} from '@openmaic/generation';
import type {
  SceneOutline,
  GeneratedSlideContent,
  GeneratedQuizContent,
  GeneratedInteractiveContent,
  GeneratedPBLContent,
} from '@/lib/types/generation';
import type { Action, SpeechAction } from '@/lib/types/action';
import type { PBLContent } from '@/lib/types/stage';
import { normalizeLegacyPBLContent } from '@/lib/pbl/legacy/read';

import { StepRefusal, type StepContext, type StepLanguageModel } from './context';

export interface SceneActionsInput {
  outline: SceneOutline;
  /** Every outline of the course, for the scene's page index and the titles around it. */
  allOutlines: SceneOutline[];
  content:
    | GeneratedSlideContent
    | GeneratedQuizContent
    | GeneratedInteractiveContent
    | GeneratedPBLContent
    | PBLContent;
  stageId: string;
  agents?: AgentInfo[];
  /** What the scenes before this one said, for continuity. */
  previousSpeeches?: string[];
  userProfile?: string;
  languageDirective?: string;
  /** The scene-actions stage's model. */
  model: StepLanguageModel;
}

export type SceneActionsRefusal = 'assembly-failed';

/**
 * Speech ration, enforced. The action prompts ask for 2-3 speeches on a
 * slide page and 3-4 on a widget page, but a model can keep elaborating in
 * speech anyway (a sandbox run produced 6-9 speech actions per scene, which
 * plays as a slow, over-explaining lesson). Between generation and assembly
 * this keeps the opening speeches and the final one and drops the middle
 * elaborations: every non-speech action (spotlights, widget events, the
 * closing discussion) survives, the teacher just says less.
 */
const SPEECH_CAPS: Record<SceneOutline['type'], number> = {
  slide: 3,
  quiz: 3,
  interactive: 4,
  pbl: 4,
};

export function capSpeechActions(
  actions: readonly Action[],
  type: SceneOutline['type'],
): Action[] {
  const cap = SPEECH_CAPS[type];
  const speechIndexes = actions.flatMap((action, index) =>
    action.type === 'speech' ? [index] : [],
  );
  if (speechIndexes.length <= cap) return [...actions];
  const keep = new Set<number>(speechIndexes.slice(0, cap - 1));
  keep.add(speechIndexes[speechIndexes.length - 1]!);
  return actions.filter((action, index) => action.type !== 'speech' || keep.has(index));
}

export type GeneratedScene = NonNullable<ReturnType<typeof buildCompleteScene>>;

export interface SceneActionsResult {
  scene: GeneratedScene;
  /** This scene's speeches, for the scenes after it. */
  previousSpeeches: string[];
}

export async function generateSceneActions(
  input: SceneActionsInput,
  ctx: StepContext,
): Promise<SceneActionsResult> {
  const { outline, allOutlines, content, stageId, agents, userProfile, languageDirective } = input;
  const {
    model: languageModel,
    modelInfo,
    modelString,
    thinkingConfig,
    serverManaged,
  } = input.model;
  const { log } = ctx;

  // Detect vision capability
  const hasVision = !!modelInfo?.capabilities?.vision;

  // AI call function (actions typically don't use vision, but kept for consistency)
  const aiCall = async (
    systemPrompt: string,
    userPrompt: string,
    images?: Array<{ id: string; src: string }>,
  ): Promise<string> => {
    if (images?.length && hasVision) {
      const result = await callLLM(
        {
          model: languageModel,
          // A run cancels the call when it loses its lease or its course.
          abortSignal: ctx.signal,
          system: systemPrompt,
          messages: [
            {
              role: 'user' as const,
              content: buildVisionUserContent(userPrompt, images),
            },
          ],
          maxOutputTokens: modelInfo?.outputWindow,
          maxRetries: 0,
        },
        'scene-actions',
        undefined,
        thinkingConfig,
        { serverManaged },
      );
      return result.text;
    }
    const result = await callLLM(
      {
        model: languageModel,
        abortSignal: ctx.signal,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: modelInfo?.outputWindow,
        maxRetries: 0,
      },
      'scene-actions',
      undefined,
      thinkingConfig,
      { serverManaged },
    );
    return result.text;
  };

  // ── Build cross-scene context ──
  const allTitles = allOutlines.map((o) => o.title);
  const pageIndex = allOutlines.findIndex((o) => o.id === outline.id);
  const generationCtx: SceneGenerationContext = {
    pageIndex: (pageIndex >= 0 ? pageIndex : 0) + 1,
    totalPages: allOutlines.length,
    allTitles,
    previousSpeeches: input.previousSpeeches ?? [],
  };

  // ── Generate actions ──
  log.info(`Generating actions: "${outline.title}" (${outline.type}) [model=${modelString}]`);

  const generationContent = (
    'type' in content && content.type === 'pbl' ? normalizeLegacyPBLContent(content) : content
  ) as
    | GeneratedSlideContent
    | GeneratedQuizContent
    | GeneratedInteractiveContent
    | GeneratedPBLContent;

  const actions = await generateActions(outline, generationContent, aiCall, {
    ctx: generationCtx,
    agents,
    userProfile,
    languageDirective,
  });

  log.info(`Generated ${actions.length} actions for: "${outline.title}"`);

  // ── Speech ration: the prompts ask for quick pacing, this enforces it ──
  const rationedActions = capSpeechActions(actions, outline.type);
  if (rationedActions.length !== actions.length) {
    log.info(
      `Speech ration for: "${outline.title}" — ${actions.length} → ${rationedActions.length} actions`,
    );
  }

  // ── Build complete scene ──
  const scene = buildCompleteScene(outline, generationContent, rationedActions, stageId);

  if (!scene) {
    log.error(`Failed to build scene: "${outline.title}"`);
    throw new StepRefusal<SceneActionsRefusal>(
      'assembly-failed',
      `Failed to build scene: ${outline.title}`,
    );
  }

  // ── Extract speeches for cross-scene coherence ──
  const previousSpeeches = (scene.actions || [])
    .filter((a): a is SpeechAction => a.type === 'speech')
    .map((a) => a.text);

  log.info(
    `Scene assembled successfully: "${outline.title}" — ${scene.actions?.length ?? 0} actions`,
  );

  return { scene, previousSpeeches };
}
