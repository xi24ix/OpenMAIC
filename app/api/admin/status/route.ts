import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerJson } from '@/lib/server/agent-runtime/route-response';
import { OWNER_ROLES, principalHasRole } from '@/lib/server/identity/types';
import { withRequestOwner } from '@/lib/server/identity/with-owner';

export const runtime = 'nodejs';

/** Returns only the caller's administrative capability; no account data. */
export async function GET(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  return withRequestOwner(req, async (principal, headers) =>
    ownerJson({ isAdmin: principalHasRole(principal, OWNER_ROLES.admin) }, 200, headers),
  );
}
