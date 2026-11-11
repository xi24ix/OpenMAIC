import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { generateTTS } from '@/lib/audio/tts-providers';

const mockFetch = vi.hoisted(() => vi.fn() as Mock);
// The provider adapters issue requests through undici's fetch (with a pinned
// dispatcher), not the Next-patched global, so the double lives here.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

/** Raw 16-bit PCM samples, as OpenRouter's HeyGen route returns them. */
function pcmBytes(count = 8000): ArrayBuffer {
  return new Uint8Array(count).fill(0x42).buffer;
}

describe('HeyGen TTS (OpenRouter pcm route)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('requests pcm and wraps the samples in a WAV container honouring the reported rate', async () => {
    const pcm = pcmBytes();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => pcm,
      headers: { get: (name: string) => (name === 'content-type' ? 'audio/pcm;rate=24000;channels=1' : null) },
    });

    const result = await generateTTS(
      {
        providerId: 'heygen-tts',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-v1-test',
        modelId: 'heygen/heygen-voice-1-turbo:free',
        voice: 'nadine',
      },
      'مرحباً بكم في الدرس',
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/audio/speech',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // HeyGen rejects `mp3` with a 400 — the route only speaks pcm.
    expect(body.response_format).toBe('pcm');
    expect(body.model).toBe('heygen/heygen-voice-1-turbo:free');
    expect(body.voice).toBe('nadine');

    // The samples arrive as a playable WAV container.
    expect(result.format).toBe('wav');
    const wav = result.audio;
    expect(wav).toBeInstanceOf(Uint8Array);
    expect(wav.byteLength).toBe(44 + pcm.byteLength);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const ascii = (offset: number, length: number) =>
      Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join('');
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint32(24, true)).toBe(24000); // sample rate from the content type
    expect(view.getUint16(22, true)).toBe(1); // channels
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(pcm.byteLength); // data chunk
    // The PCM samples follow the header untouched.
    expect(wav[44]).toBe(0x42);
  });

  it('defaults the WAV layout to 44.1 kHz mono when the content type omits them', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => pcmBytes(100),
      headers: { get: (name: string) => (name === 'content-type' ? 'audio/pcm' : null) },
    });

    const result = await generateTTS(
      {
        providerId: 'heygen-tts',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-v1-test',
        modelId: 'heygen/heygen-voice-1-turbo:free',
        voice: 'nadine',
      },
      'hi',
    );

    const view = new DataView(result.audio.buffer, result.audio.byteOffset, result.audio.byteLength);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(22, true)).toBe(1);
  });

  it('rejects an empty pcm response like every other provider', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new Uint8Array(0).buffer,
      headers: { get: (name: string) => (name === 'content-type' ? 'audio/pcm;rate=44100;channels=1' : null) },
    });

    await expect(
      generateTTS(
        {
          providerId: 'heygen-tts',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-or-v1-test',
          modelId: 'heygen/heygen-voice-1-turbo:free',
          voice: 'nadine',
        },
        'hi',
      ),
    ).rejects.toThrow(/empty audio response/);
  });

  it('keeps the plain OpenAI path on mp3 (no wrap)', async () => {
    const mp3 = new Uint8Array(32).fill(0xff);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mp3.buffer,
      headers: { get: (name: string) => (name === 'content-type' ? 'audio/mpeg' : null) },
    });

    const result = await generateTTS(
      { providerId: 'openai-tts', apiKey: 'sk-test', voice: 'alloy' },
      'hello',
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.response_format).toBe('mp3');
    expect(result.format).toBe('mp3');
    expect(result.audio.byteLength).toBe(32);
  });
});
