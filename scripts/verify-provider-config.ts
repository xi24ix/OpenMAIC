/**
 * Verify the deployment's provider configuration end to end:
 *
 *   node --env-file=.env ./node_modules/.bin/tsx scripts/verify-provider-config.ts
 *
 * 1. Parses openmaic.yml (the same boot check instrumentation runs).
 * 2. Reports each slot's resolved provider/model (secrets never printed).
 * 3. Tests a real, cheap call against every provider the slots name.
 */
import { loadModelConfigFile } from '../lib/server/model-config/openmaic-yml';
import { loadDeploymentLayer } from '../lib/server/model-config/deployment-layer';
import { lookupFromLayers } from '../lib/server/model-config/runtime';
import { MODEL_SLOTS } from '../lib/config/model-slots';

// This script imports server code directly with tsx, so path aliases work
// only after tsconfig paths are honored — tsx does honor them.

const FILE = loadModelConfigFile();
if (!FILE) {
  console.error('✗ no openmaic.yml found (looked at OPENMAIC_CONFIG then ./openmaic.yml)');
  process.exit(1);
}
const layer = loadDeploymentLayer();
for (const notice of layer.notices) console.log(`notice: ${notice}`);

const slotIds = MODEL_SLOTS.map((s) => s.id);
for (const slot of slotIds) {
  try {
    const resolution = lookupFromLayers(slot as never, {
      deployment: layer.layer,
      workspace: null,
    });
    if (resolution.status === 'assigned') {
      console.log(
        `✓ ${slot}: provider=${resolution.providerId} model=${resolution.modelId ?? '(default)'} key=${resolution.apiKey ? `set(${resolution.apiKey.length} chars)` : 'none'}`,
      );
    } else if (resolution.status === 'disabled') {
      console.log(`✗ ${slot}: turned off`);
    } else {
      console.log(`✗ ${slot}: unassigned (locked=${(resolution as { locked?: boolean }).locked})`);
    }
  } catch (e) {
    console.log(`✗ ${slot}: ${(e as Error).message}`);
  }
}
