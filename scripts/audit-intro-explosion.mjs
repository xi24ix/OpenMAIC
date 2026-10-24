/**
 * Local audit for lib/server/generation/run/intro-explosion.ts (Windows checkout,
 * no runtime deps beyond the type-only aliases which transpile away).
 * Usage: node scripts/audit-intro-explosion.mjs (temporary, untracked)
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const src = readFileSync('lib/server/generation/run/intro-explosion.ts', 'utf8');
const emit = ts.transpileModule(src, { compilerOptions: { module: 'CommonJS', target: 'ES2022' } });
const tmp = mkdtempSync(join(tmpdir(), 'explode-'));
const file = join(tmp, 'intro-explosion.js');
writeFileSync(file, emit.outputText);
const { explodeExplainerOutlines } = await import(`file://${file.replace(/\\/g, '/')}`);

{
  const checks = [];
  const assert = (name, cond) => {
    checks.push([name, cond]);
    if (!cond) console.error(`FAIL: ${name}`);
  };

  const outline = {
    id: 'scene_intro',
    order: 5,
    type: 'interactive',
    title: 'دورة الماء',
    description: 'Motion-graphic intro for the water cycle.',
    keyPoints: ['a', 'b'],
    widgetType: 'animation-explainer',
    widgetOutline: {
      type: 'animation-explainer',
      concept: 'دورة الماء في الطبيعة',
      keyBeats: [
        'Hook — السؤال المركزي',
        'Tease — كلمات مفتاحية',
        'Spark — الرسم المتحرك',
        'Title — العنوان',
      ],
      mood: 'playful',
    },
  };

  // 1. Basic explosion: 4 beats → 3 widget scenes + 1 cover slide
  const out = explodeExplainerOutlines([outline]);
  assert('4 scenes total', out.length === 4);
  assert('covers order renumbered', out.map((o) => o.order).join(',') === '0,1,2,3');
  assert(
    'phases p0..p2 assigned',
    out
      .slice(0, 3)
      .map((o) => o.widgetOutline.startPhase)
      .join(',') === 'p0,p1,p2',
  );
  assert('cover is a slide', out[3].type === 'slide' && out[3].widgetOutline === undefined && out[3].widgetType === undefined);
  assert(
    'group ids shared',
    new Set(out.slice(0, 3).map((o) => o.widgetOutline.groupId)).size === 1,
  );
  assert(
    'beatCount consistent',
    out.slice(0, 3).every((o) => o.widgetOutline.beatCount === 4),
  );
  assert(
    'media stripped from siblings',
    out.every((o) => o.mediaGenerations === undefined && o.suggestedImageIds === undefined),
  );
  assert(
    'keyBeats trimmed onto siblings',
    out[0].widgetOutline.keyBeats.length === 4,
  );
  assert(
    'cover key points mention the lesson title',
    out[3].keyPoints.some((k) => k.includes('دورة الماء')),
  );

  // 2. Idempotence: re-exploding an exploded list changes nothing
  const again = explodeExplainerOutlines(out);
  assert(
    'idempotent round trip',
    JSON.stringify(again.map((o) => [o.id, o.type, o.widgetOutline?.startPhase ?? null])) ===
      JSON.stringify(out.map((o) => [o.id, o.type, o.widgetOutline?.startPhase ?? null])),
  );

  // 3. Non-explainer passthrough
  const sim = { ...outline, id: 'scene_sim', widgetType: 'simulation' };
  assert('simulation untouched', explodeExplainerOutlines([sim]).length === 1 && explodeExplainerOutlines([sim])[0].id === 'scene_sim');

  // 4. Mixed outline keep relative order
  const mixed = explodeExplainerOutlines([sim, outline, sim]);
  assert('mixed order stable (1 + 4 + 1)', mixed.length === 6);
  assert('mixed numbering', mixed.map((o) => o.order).join(',') === [...Array(6).keys()].join(','));

  // 5. Over-cap beats trimmed to MAX_INTRO_SCENES
  const big = {
    ...outline,
    id: 'scene_big',
    widgetOutline: {
      ...outline.widgetOutline,
      keyBeats: Array.from({ length: 8 }, (_, i) => `Beat${i} — شيء`),
    },
  };
  const capped = explodeExplainerOutlines([big]);
  assert('capped to 6 scenes', capped.length === 6);
  assert('trimmed keyBeats = 6', capped[0].widgetOutline.keyBeats.length === 6);

  // 6. Degenerate: no beats list at all
  const noBeats = { ...outline, id: 'scene_nobeats', widgetOutline: { type: 'animation-explainer', concept: 'x' } };
  assert('no beats -> still explodes with defaults', explodeExplainerOutlines([noBeats]).length === 4);

  // 7. Non-interactive is untouched
  const slide = { ...outline, id: 'scene_slide', type: 'slide', widgetType: undefined, widgetOutline: undefined };
  assert('slide untouched', explodeExplainerOutlines([slide]).length === 1);

  const failed = checks.filter(([, ok]) => !ok);
  console.log(`intro-explosion audit: ${checks.length - failed.length}/${checks.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
