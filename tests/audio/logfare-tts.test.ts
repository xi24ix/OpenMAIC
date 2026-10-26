import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { generateTTS } from '@/lib/audio/tts-providers';

const mockFetch = vi.hoisted(() => vi.fn() as Mock);
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

describe('Logfare TTS', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends only documented fields when no model-specific voice is selected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: { get: () => 'audio/mpeg' },
    });

    const result = await generateTTS(
      {
        providerId: 'logfare-tts',
        apiKey: 'logfare-test',
        voice: 'default',
      },
      'Hello from Logfare',
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://logfare.ai/v1/audio/speech',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      model: 'aura-2-en',
      input: 'Hello from Logfare',
    });
    expect(result.format).toBe('mp3');
    expect(result.audio).toEqual(new Uint8Array([1, 2, 3]));
  });
});
