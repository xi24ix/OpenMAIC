/**
 * Image: generate one image from a prompt through the image slot's provider.
 * Moved from POST /api/generate/image, which keeps resolving the slot (with
 * the request's deprecated provider headers) and mapping failures to its
 * responses.
 */
import { authorizeMediaModel } from '@/lib/server/model-config/media';
import { generateImage, IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageProviderId,
} from '@/lib/media/types';
import { resolveImageModel } from '@/lib/server/provider-config';
import type { MediaConnection } from '@/lib/server/model-config/media';
import { withMediaProviderFetch } from '@/lib/server/media-provider-fetch';
import { resolveImageSize } from '@/lib/server/image-sizing';
import { recordGenerationUsage } from '@/lib/server/usage-storage';

import { StepRefusal, type StepContext } from './context';

export interface ImageInput {
  options: ImageGenerationOptions;
  /** The image slot's connection. */
  connection: MediaConnection;
  /**
   * The model a deprecated request names; it still applies, through the
   * provider's allowlist, on the legacy default provider.
   */
  requestedModel?: string;
}

export type ImageRefusal = 'missing-api-key' | 'missing-model';

/**
 * The environment variable naming the fallback image model (`IMAGE_FALLBACK_MODEL`),
 * used when the configured model's provider fails retryably. The fallback rides
 * the SAME provider connection — it is a cheaper/different model id on the same
 * endpoint, not a second provider — so it helps against transient failures
 * (429/5xx) and model-specific quota states, and cuts cost; it cannot conjure
 * images on an account that cannot pay any image model at all.
 */
const IMAGE_FALLBACK_MODEL_ENV = 'IMAGE_FALLBACK_MODEL';

/**
 * The HTTP-ish status a provider failure carries, parsed from its message.
 * Adapters phrase failures differently ("OpenRouter image generation failed
 * (402): …"), so both the parenthesised form and a bare code are matched.
 */
function imageProviderFailureStatus(error: unknown): number | undefined {
  const text = error instanceof Error ? error.message : String(error);
  const match =
    /failed \((\d{3})\)/.exec(text) ?? /(?:status[: ]|\b)(402|429|50\d)\b(?!\d)/.exec(text);
  return match ? Number(match[1]) : undefined;
}

/** Whether one fallback-model roll is worth a failure: quota and transient states. */
function imageFallbackEligible(error: unknown): boolean {
  const status = imageProviderFailureStatus(error);
  return status !== undefined && (status === 402 || status === 429 || status >= 500);
}

export async function generateImageStep(
  input: ImageInput,
  ctx: StepContext,
): Promise<ImageGenerationResult> {
  const { connection } = input;
  const { providerId, apiKey, baseUrl, managed } = connection as MediaConnection & {
    providerId: ImageProviderId;
  };
  const provider = IMAGE_PROVIDERS[providerId];
  if (provider?.requiresApiKey && !apiKey) {
    throw new StepRefusal<ImageRefusal>(
      'missing-api-key',
      `No API key configured for image provider: ${providerId}`,
    );
  }
  // A configured slot without a model uses the provider's first catalogue
  // model. On the legacy default provider the request's model still applies
  // through its allowlist, as before slots.
  const model =
    connection.origin === 'configuration'
      ? (connection.modelId ?? provider?.models?.[0]?.id)
      : connection.origin === 'default'
        ? resolveImageModel(providerId, input.requestedModel)
        : connection.modelId;
  // Workflow-based providers (e.g. comfyui-image) have no model catalog and
  // need no model; everyone else must resolve one.
  if (!model && provider?.models && provider.models.length > 0) {
    throw new StepRefusal<ImageRefusal>(
      'missing-model',
      `No model configured for image provider: ${providerId}`,
    );
  }

  authorizeMediaModel(connection, 'image', model);
  const sizedOptions = resolveImageSize(input.options, { providerId, modelId: model });

  ctx.log.info(
    `Generating image: provider=${providerId}, model=${model || 'default'}, ` +
      `prompt="${sizedOptions.prompt.slice(0, 80)}...", size=${sizedOptions.width ?? 'auto'}x${sizedOptions.height ?? 'auto'}`,
  );

  const generateWith = (modelId: string | undefined) =>
    generateImage(
      withMediaProviderFetch(
        { providerId, apiKey: apiKey ?? '', baseUrl, model: modelId },
        managed,
      ),
      modelId === model ? sizedOptions : resolveImageSize(input.options, { providerId, modelId }),
    );

  let result: ImageGenerationResult;
  try {
    result = await generateWith(model);
  } catch (error) {
    // One fallback-model roll on a retryable provider failure. The allowlist
    // decides whether the fallback model may run at all; a refusal there
    // keeps the original error rather than trading it for a worse one.
    const fallbackModel = process.env[IMAGE_FALLBACK_MODEL_ENV]?.trim() || undefined;
    if (!imageFallbackEligible(error) || !fallbackModel || fallbackModel === model) throw error;
    try {
      authorizeMediaModel(connection, 'image', fallbackModel);
    } catch {
      throw error;
    }
    ctx.log.warn(
      `Image generation failed (status ${imageProviderFailureStatus(error) ?? 'unknown'}); ` +
        `retrying once with fallback model ${fallbackModel}`,
    );
    result = await generateWith(fallbackModel);
    void recordGenerationUsage({
      kind: 'image',
      unit: 'image',
      providerId,
      modelId: fallbackModel,
      quantity: 1,
    });
    return result;
  }

  void recordGenerationUsage({
    kind: 'image',
    unit: 'image',
    providerId,
    modelId: model,
    quantity: 1,
  });

  return result;
}
