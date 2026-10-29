/**
 * The shipped `openmaic.yml` (the deployment's own provider configuration) is
 * parsed with the real schema as part of test coverage, so an operator edit
 * that drifts from what the server accepts stops here instead of killing the
 * container at boot. Every `${VAR}` is replaced with a dummy value, exactly
 * as the running deployment receives them from the environment.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseModelConfig } from '@/lib/server/model-config/openmaic-yml';

const ROOT = path.resolve(__dirname, '../../..');

function deploymentEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [, name] of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    env[name] = 'test-value';
  }
  return env;
}

describe('the deployment openmaic.yml', () => {
  const file = path.join(ROOT, 'openmaic.yml');
  const text = fs.readFileSync(file, 'utf-8');

  it('parses with the real schema', () => {
    const parsed = parseModelConfig(text, { file, env: deploymentEnv(text) });
    expect(parsed.slots?.tts).toBeDefined();
    expect(parsed.slots?.llm).toBeDefined();
  });

  it('assigns the tts slot to the fish provider with its pinned model', () => {
    const parsed = parseModelConfig(text, { file, env: deploymentEnv(text) });
    const assignment = parsed.slots?.tts as string;
    const [provider, model] = assignment.split(':');
    expect(provider).toBe('speech-fish');
    expect(model).toBe('s2.1-pro-free');
    expect(parsed.providers?.['speech-fish']).toMatchObject({
      preset: 'fish-tts',
      options: { voice: 'test-value' },
    });
  });
});
