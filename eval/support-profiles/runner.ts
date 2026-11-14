/**
 * Support-Profile A/B — Real LLM Evaluation Runner
 *
 * Generates the same lesson outline once per learning-support profile (plus
 * the no-profile baseline) and reports how the outputs differ: scene types,
 * widget mix, the engagement rhythm (no two consecutive teaching slides), and
 * the scene count. No LLM judge — the deltas are what a human reviews.
 *
 * Purpose: the support instructions promise behavior (short task cycles for
 * ADHD, predictable structure for autism, …). This harness shows whether the
 * promise lands in the outline.
 *
 * Required env:
 *   EVAL_INFERENCE_MODEL  Model for outline generation (or DEFAULT_MODEL)
 *
 * Usage:
 *   EVAL_INFERENCE_MODEL=openrouter:z-ai/glm-5.3-flash pnpm eval:support-profiles
 *
 * Output: eval/support-profiles/results/<model>/<timestamp>/report.md
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { generateSceneOutlinesFromRequirements } from '@openmaic/generation';

import { learnerDirectiveBlock, type SupportProfile } from '@/lib/server/learner-support';

import { resolveEvalModel } from '../shared/resolve-model';

const REQUIREMENT =
  'Create a grade 10 English lesson about persuasive advertising: how ads use emotion, repetition and calls to action to influence people, and how to spot these techniques.';

const PROFILES: readonly (SupportProfile | 'none')[] = [
  'none',
  'autism',
  'adhd',
  'learning-difficulties',
];

interface ProfileResult {
  profile: SupportProfile | 'none';
  error?: string;
  sceneCount?: number;
  types?: string[];
  widgetTypes?: string[];
  consecutiveSlideRuns?: number[];
  quizCount?: number;
  mediaPlanned?: number;
  languageDirective?: string;
}

function rhythmRuns(outlines: Array<{ type: string; widgetType?: string }>): number[] {
  // The lengths of consecutive pure-teaching slide runs; 2+ is a boredom run.
  const runs: number[] = [];
  let run = 0;
  for (const outline of outlines) {
    if (outline.type === 'slide' && !outline.widgetType) {
      run += 1;
    } else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs;
}

async function runProfile(
  profile: SupportProfile | 'none',
  model: { model: unknown; modelString: string },
): Promise<ProfileResult> {
  const directive = learnerDirectiveBlock({
    ...(profile !== 'none' ? { supportProfile: profile } : {}),
  });
  const requirement = directive ? `${directive}\n\n${REQUIREMENT}` : REQUIREMENT;
  try {
    const result = await generateSceneOutlinesFromRequirements(
      { requirement },
      undefined,
      model as never,
    );
    const outlines = (result.outlines ?? []) as Array<{
      type: string;
      widgetType?: string;
      mediaGenerations?: unknown[];
    }>;
    return {
      profile,
      sceneCount: outlines.length,
      types: outlines.map((o) => o.type),
      widgetTypes: outlines.filter((o) => o.type === 'interactive').map((o) => o.widgetType ?? '?'),
      consecutiveSlideRuns: rhythmRuns(outlines),
      quizCount: outlines.filter((o) => o.type === 'quiz').length,
      mediaPlanned: outlines.reduce((count, o) => count + (o.mediaGenerations?.length ?? 0), 0),
      languageDirective: result.languageDirective?.slice(0, 120),
    };
  } catch (error) {
    return { profile, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const { model, modelString } = resolveEvalModel('EVAL_INFERENCE_MODEL');
  const results: ProfileResult[] = [];
  for (const profile of PROFILES) {
    process.stdout.write(`Generating for profile "${profile}"...\n`);
    results.push(await runProfile(profile, model));
  }

  const dir = join(
    process.cwd(),
    'eval/support-profiles/results',
    modelString.replace(/[^A-Za-z0-9._-]/g, '_'),
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  mkdirSync(dir, { recursive: true });

  const lines = [
    '# Support-Profile A/B',
    '',
    `Model: ${modelString}`,
    `Requirement: ${REQUIREMENT}`,
    '',
    '| Profile | Scenes | Types | Widgets | Slide runs | Quiz | Planned media |',
    '|---|---|---|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.profile} | ${r.sceneCount ?? r.error} | ${(r.types ?? []).join(' → ')} | ${(r.widgetTypes ?? []).join(', ') || '-'} | ${(r.consecutiveSlideRuns ?? []).join(', ') || '-'} | ${r.quizCount ?? '-'} | ${r.mediaPlanned ?? '-'} |`,
    ),
    '',
    'Reads: slide runs of 2+ are boredom runs the engagement rhythm should have prevented; the autism profile should show predictable slide→interactive alternation with lower widget complexity; the ADHD profile should show more, shorter interactive scenes.',
    '',
    'Full outlines:',
    '',
    ...results.map(
      (r) =>
        `## ${r.profile}\n\n\`\`\`json\n${JSON.stringify(r, null, 2).slice(0, 6000)}\n\`\`\`\n`,
    ),
  ];
  const report = lines.join('\n');
  writeFileSync(join(dir, 'report.md'), report);
  process.stdout.write(`${report}\n`);
  process.stdout.write(`Report written to ${join(dir, 'report.md')}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
