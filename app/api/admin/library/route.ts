import type { NextRequest } from 'next/server';

import type { Queryable } from '@openmaic/storage/document/pg';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { apiError } from '@/lib/server/api-response';
import { OWNER_ROLES, principalHasRole } from '@/lib/server/identity/types';
import { ownerApiError, ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface AdminLibraryRow extends Record<string, unknown> {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  is_public: boolean;
  published_at: number | string | null;
  generation_complete: boolean;
  created_at: number | string;
  updated_at: number | string;
  scene_count: string;
  total_count: string;
}

function integerParam(value: string | null, fallback: number): number | undefined {
  if (value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Read-only platform-wide course index for an authenticated administrator. */
export async function GET(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  const limit = integerParam(req.nextUrl.searchParams.get('limit'), DEFAULT_LIMIT);
  const offset = integerParam(req.nextUrl.searchParams.get('offset'), 0);
  if (limit === undefined || limit < 1 || limit > MAX_LIMIT) {
    return apiError('INVALID_REQUEST', 400, `limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  if (offset === undefined)
    return apiError('INVALID_REQUEST', 400, 'offset must be a non-negative integer');

  return withRequestOwner(req, async (principal, responseHeaders) => {
    if (!principalHasRole(principal, OWNER_ROLES.admin)) {
      return ownerApiError(
        'INVALID_REQUEST',
        403,
        'administrator access required',
        responseHeaders,
      );
    }

    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const result = await (pool as unknown as Queryable).query<AdminLibraryRow>(
      `SELECT stages.id,
              stages.name,
              stages.description,
              meta.owner_id,
              meta.is_public,
              meta.published_at,
              meta.generation_complete,
              stages.created_at,
              stages.updated_at,
              (SELECT COUNT(*) FROM document_scenes AS scenes
                WHERE scenes.stage_id = stages.id)::text AS scene_count,
              COUNT(*) OVER()::text AS total_count
         FROM document_stages AS stages
         JOIN stage_meta AS meta ON meta.stage_id = stages.id
        WHERE meta.deleted_at IS NULL
        ORDER BY stages.updated_at DESC, stages.id DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const total = Number(result.rows[0]?.total_count ?? 0);
    return ownerJson(
      {
        courses: result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          ...(row.description === null ? {} : { description: row.description }),
          ownerId: row.owner_id,
          isPublic: row.is_public,
          publishedAt: row.published_at === null ? null : Number(row.published_at),
          generationComplete: row.generation_complete,
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
          sceneCount: Number(row.scene_count),
        })),
        total,
        limit,
        offset,
      },
      200,
      responseHeaders,
    );
  });
}
