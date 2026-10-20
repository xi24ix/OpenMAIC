/**
 * GET /api/materials/[id]/pages — a PDF's page count, for the page picker.
 * GET /api/materials/[id]/pages?page=N — page N as a PNG thumbnail.
 *
 * The picker shows page cards before extraction starts, so a PDF upload is
 * made with `?extract=false` and its extraction waits for the selection.
 * Reading a page keeps the upload alive, as `GET /api/materials/[id]` does.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { isMaterialId } from '@/lib/server/materials/material-id';
import { getMaterialByteStore } from '@/lib/server/materials/bytes';
import {
  InvalidPdfPageSelectionError,
  readPdfPageCount,
  renderPdfPagePng,
} from '@/lib/server/materials/pdf-pages';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { touchOwnerMaterial } from '@/lib/persistence/owner-materials';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwner(req, async ({ ownerId }, responseHeaders) => {
    const { id } = await params;
    if (!isMaterialId(id)) return ownerNotFound(responseHeaders);
    const page = new URL(req.url).searchParams.get('page');
    if (page !== null && !/^\d+$/.test(page)) {
      return ownerApiError(
        'INVALID_REQUEST',
        400,
        'page must be a positive integer',
        responseHeaders,
      );
    }

    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const record = await touchOwnerMaterial(pool, ownerId, id);
    if (!record) return ownerNotFound(responseHeaders);
    if (record.mime !== 'application/pdf') {
      return ownerApiError(
        'INVALID_REQUEST',
        400,
        'Only PDF materials have pages',
        responseHeaders,
      );
    }

    const bytes = await getMaterialByteStore().get(record.ossKey);
    try {
      if (page === null) {
        const pageCount = await readPdfPageCount(bytes);
        const headers = new Headers(responseHeaders);
        headers.set('Cache-Control', 'private, max-age=600');
        return Response.json({ pageCount }, { headers });
      }
      const image = await renderPdfPagePng(bytes, Number(page));
      const headers = new Headers(responseHeaders);
      headers.set('Content-Type', 'image/png');
      headers.set('Cache-Control', 'private, max-age=86400, immutable');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(new Uint8Array(image), { headers });
    } catch (error) {
      if (error instanceof InvalidPdfPageSelectionError) {
        return ownerApiError('INVALID_REQUEST', 400, error.message, responseHeaders);
      }
      throw error;
    }
  });
}
