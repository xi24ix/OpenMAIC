/**
 * POST /api/materials/[id]/extraction — extract one of the caller's own
 * library uploads again after its extraction failed (the composer's Retry),
 * or start one that never started (`idle`). Answers the material as
 * `GET /api/materials/[id]` does, now `extracting`. An extraction that is
 * running or ready is left as it is (`409`); an id the owner does not have
 * answers a plain 404. Needs only server persistence.
 *
 * A PDF body may name the pages to process: `{ "pages": [1, 3, 8] }` or
 * `{ "pages": "all" }`. The selection is validated against the document,
 * stored on the material, and the PDF is sliced to it before the extractor
 * runs, so every extractor only sees the chosen pages.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import {
  getOwnerMaterial,
  publicMaterial,
  startOwnerMaterialExtractions,
} from '@/lib/persistence/owner-materials';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { isMaterialId } from '@/lib/server/materials/material-id';
import { getMaterialByteStore } from '@/lib/server/materials/bytes';
import {
  InvalidPdfPageSelectionError,
  normalizePdfPages,
  readPdfPageCount,
} from '@/lib/server/materials/pdf-pages';
import { wakeOwnerMaterialExtractor } from '@/lib/server/materials/extractor-wake';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

async function requestedPages(req: NextRequest): Promise<unknown> {
  if (!req.body) return undefined;
  const body = (await req.json().catch(() => null)) as { pages?: unknown } | null;
  return body && typeof body === 'object' ? body.pages : undefined;
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwner(req, async ({ ownerId }, responseHeaders) => {
    const { id } = await params;
    if (!isMaterialId(id)) return ownerNotFound(responseHeaders);
    const pages = await requestedPages(req);
    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const record = await getOwnerMaterial(pool, ownerId, id);
    if (!record) return ownerNotFound(responseHeaders);

    let selection: { pages: number[]; sourcePageCount: number } | undefined;
    if (pages !== undefined) {
      if (record.mime !== 'application/pdf') {
        return ownerApiError(
          'INVALID_REQUEST',
          400,
          'Only PDF materials accept a page selection',
          responseHeaders,
        );
      }
      try {
        const bytes = await getMaterialByteStore().get(record.ossKey);
        const pageCount = await readPdfPageCount(bytes);
        selection = {
          pages:
            pages === 'all'
              ? Array.from({ length: pageCount }, (_, index) => index + 1)
              : normalizePdfPages(pages, pageCount),
          sourcePageCount: pageCount,
        };
      } catch (error) {
        if (error instanceof InvalidPdfPageSelectionError) {
          return ownerApiError('INVALID_REQUEST', 400, error.message, responseHeaders);
        }
        throw error;
      }
    }

    const started = selection
      ? await startOwnerMaterialExtractions(pool, ownerId, [id], ['failed', 'idle'], selection)
      : await startOwnerMaterialExtractions(pool, ownerId, [id], ['failed', 'idle']);
    const updated = await getOwnerMaterial(pool, ownerId, id);
    if (!updated) return ownerNotFound(responseHeaders);
    if (started.length === 0) {
      return ownerApiError(
        'INVALID_REQUEST',
        409,
        `The material's extraction is ${updated.extraction?.status ?? 'idle'}`,
        responseHeaders,
      );
    }
    wakeOwnerMaterialExtractor();
    return ownerJson({ material: publicMaterial(updated) }, 200, responseHeaders);
  });
}
