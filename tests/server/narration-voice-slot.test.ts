import { describe, expect, it } from 'vitest';

import { slotVoice } from '@/lib/server/generation/run/narration-voice';
import type { MediaConnection } from '@/lib/server/model-config/media';
import type { TTSProviderId } from '@/lib/audio/types';

/** A `tts` slot connection for one provider, with the fields the voice reads. */
function targetFor(
  providerId: TTSProviderId,
  options: MediaConnection['options'],
  modelId?: string,
) {
  return {
    connection: {
      providerId,
      managed: true,
      userEndpoint: false,
      origin: 'configuration' as const,
      ...(options ? { options } : {}),
      ...(modelId ? { modelId } : {}),
    } satisfies MediaConnection,
    providerId,
    ...(modelId ? { modelId } : {}),
  };
}

describe('slotVoice', () => {
  it('speaks through the deployment-pinned voice (openmaic.yml options.voice) when the run names none', () => {
    const voice = slotVoice(
      targetFor('fish-tts', { voice: 'befb212fad7d41dca17a0c21eab52834' }, 's2.1-pro-free'),
      undefined,
    );
    expect(voice.voice).toBe('befb212fad7d41dca17a0c21eab52834');
    expect(voice.speed).toBe(1);
  });

  it("keeps the run’s own voice when it serves the slot’s provider", () => {
    const voice = slotVoice(
      targetFor('fish-tts', { voice: 'befb212fad7d41dca17a0c21eab52834' }),
      { providerId: 'fish-tts', voiceId: 'ca3007f96ae7499ab87d27ea3599956a', speed: 1.2 },
    );
    expect(voice.voice).toBe('ca3007f96ae7499ab87d27ea3599956a');
    expect(voice.speed).toBe(1.2);
  });

  it("falls back to the deployment voice when the run preference is for another provider", () => {
    const voice = slotVoice(
      targetFor('fish-tts', { voice: 'befb212fad7d41dca17a0c21eab52834' }),
      { providerId: 'openai-tts', voiceId: 'marin', speed: 1 },
    );
    expect(voice.voice).toBe('befb212fad7d41dca17a0c21eab52834');
  });

  it("falls back to the catalogue default without a deployment voice", () => {
    const voice = slotVoice(targetFor('fish-tts', undefined), undefined);
    expect(voice.voice).toBe('default');
  });

  it("ignores a badly typed options.voice and uses the catalogue default", () => {
    const voice = slotVoice(targetFor('fish-tts', { voice: 7 }), undefined);
    expect(voice.voice).toBe('default');
  });

  it("ignores a blank options.voice", () => {
    const voice = slotVoice(targetFor('fish-tts', { voice: '   ' }), undefined);
    expect(voice.voice).toBe('default');
  });
});
