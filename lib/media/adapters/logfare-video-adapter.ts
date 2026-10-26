import type {
  VideoGenerationConfig,
  VideoGenerationOptions,
  VideoGenerationResult,
} from '../types';
import { mediaFetchFor } from '../media-fetch';
import { connectivityHttpFailure, connectivityTransportFailure } from '../probe-auth';
import { assertNotRedirected } from '../redirect-guard';
import { requireModel } from '../require-model';

interface LogfareVideoResponse {
  url?: string;
  video_url?: string;
  duration?: number;
  video?: { url?: string; b64_json?: string; duration?: number };
  data?: Array<{ url?: string; b64_json?: string; duration?: number }>;
}

function dimensions(aspectRatio?: string): { width: number; height: number } {
  switch (aspectRatio) {
    case '9:16':
      return { width: 720, height: 1280 };
    case '1:1':
      return { width: 1024, height: 1024 };
    default:
      return { width: 1280, height: 720 };
  }
}

export async function testLogfareVideoConnectivity(
  config: VideoGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  const baseUrl = (config.baseUrl || 'https://logfare.ai/v1').replace(/\/+$/, '');
  let response: Response;
  try {
    response = await mediaFetchFor(config)(`${baseUrl}/models`, {
      method: 'GET',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
  } catch (error) {
    return connectivityTransportFailure('Logfare Video', error);
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.ok) return { success: true, message: 'Connected to Logfare' };
  return connectivityHttpFailure('Logfare Video', response.status);
}

export async function generateWithLogfareVideo(
  config: VideoGenerationConfig,
  options: VideoGenerationOptions,
): Promise<VideoGenerationResult> {
  const baseUrl = (config.baseUrl || 'https://logfare.ai/v1').replace(/\/+$/, '');
  const response = await mediaFetchFor(config)(`${baseUrl}/videos/generations`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: requireModel(config.model, 'Logfare Video'),
      prompt: options.prompt,
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  assertNotRedirected(response, 'Logfare Video');
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Logfare video generation failed (${response.status}): ${text}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const videoBytes = contentType.startsWith('video/') ? await response.arrayBuffer() : undefined;
  const data = videoBytes ? undefined : ((await response.json()) as LogfareVideoResponse);
  const asset = data?.video ?? data?.data?.[0];
  const url =
    data?.url ??
    data?.video_url ??
    asset?.url ??
    (asset?.b64_json
      ? `data:video/mp4;base64,${asset.b64_json}`
      : videoBytes
        ? `data:${contentType};base64,${Buffer.from(videoBytes).toString('base64')}`
        : undefined);

  if (!url) throw new Error('Logfare video response did not include a video URL or file');

  const size = dimensions(options.aspectRatio);
  return {
    url,
    duration: data?.duration ?? asset?.duration ?? options.duration ?? 8,
    width: size.width,
    height: size.height,
  };
}
