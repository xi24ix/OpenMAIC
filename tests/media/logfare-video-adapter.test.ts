import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  generateWithLogfareVideo,
  testLogfareVideoConnectivity,
} from '@/lib/media/adapters/logfare-video-adapter';

const mockFetch = vi.fn() as Mock;
vi.stubGlobal('fetch', mockFetch);

describe('Logfare video adapter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('tests the stored key without starting a video generation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    });

    const result = await testLogfareVideoConnectivity({
      providerId: 'logfare-video',
      apiKey: 'logfare-test',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://logfare.ai/v1/models',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: { Authorization: expect.stringContaining('logfare-test') },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('submits the documented model and prompt and returns the completed video', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        data: [{ url: 'https://cdn.example.com/video.mp4' }],
        duration: 6,
      }),
    });

    const result = await generateWithLogfareVideo(
      {
        providerId: 'logfare-video',
        apiKey: 'logfare-test',
        model: 'sample-video-model',
      },
      { prompt: 'A calm ocean at sunrise' },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://logfare.ai/v1/videos/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('logfare-test'),
          'Content-Type': 'application/json',
        }),
        redirect: 'manual',
        body: JSON.stringify({
          model: 'sample-video-model',
          prompt: 'A calm ocean at sunrise',
        }),
      }),
    );
    expect(result).toEqual({
      url: 'https://cdn.example.com/video.mp4',
      duration: 6,
      width: 1280,
      height: 720,
    });
  });
});
