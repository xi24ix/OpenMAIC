import { NextRequest, NextResponse } from 'next/server';

import {
  curriculumErrorResponse,
  curriculumUnitContext,
  formatCurriculumGenerationPreparation,
  type CurriculumGenerationRequest,
} from '@/lib/server/curriculum-kb';

export const runtime = 'nodejs';

class CurriculumRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CurriculumRequestError';
  }
}

function parseRequest(value: unknown): CurriculumGenerationRequest {
  if (!value || typeof value !== 'object') {
    throw new CurriculumRequestError('Invalid curriculum request');
  }
  const input = value as Record<string, unknown>;
  if (typeof input.courseId !== 'string' || typeof input.unitId !== 'string') {
    throw new CurriculumRequestError('courseId and unitId are required');
  }
  const audience = input.audience;
  const supportProfile = input.supportProfile;
  if (!['student', 'parent', 'teacher'].includes(String(audience))) {
    throw new CurriculumRequestError('audience is invalid');
  }
  if (!['none', 'autism', 'adhd', 'learning-difficulties'].includes(String(supportProfile))) {
    throw new CurriculumRequestError('supportProfile is invalid');
  }
  return {
    courseId: input.courseId,
    unitId: input.unitId,
    audience: audience as CurriculumGenerationRequest['audience'],
    supportProfile: supportProfile as CurriculumGenerationRequest['supportProfile'],
  };
}

export async function POST(request: NextRequest) {
  try {
    const input = parseRequest(await request.json());
    const context = await curriculumUnitContext(input.courseId, input.unitId);
    if (context.status === 'not_available' || context.primaryContent.length === 0) {
      return NextResponse.json(
        {
          error: 'This unit does not have usable primary textbook content yet.',
          code: 'unit_not_available',
          warnings: context.warnings,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(formatCurriculumGenerationPreparation(context, input));
  } catch (error) {
    if (error instanceof CurriculumRequestError) {
      return NextResponse.json({ error: error.message, code: 'invalid_request' }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'invalid_request' },
        { status: 400 },
      );
    }
    return curriculumErrorResponse(error);
  }
}
