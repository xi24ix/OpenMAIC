import { NextResponse } from 'next/server';

import { curriculumCatalog, curriculumErrorResponse } from '@/lib/server/curriculum-kb';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(await curriculumCatalog(), {
      headers: { 'Cache-Control': 'private, max-age=300' },
    });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}
