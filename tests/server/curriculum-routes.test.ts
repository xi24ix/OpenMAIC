import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  curriculumCatalog: vi.fn(),
  curriculumUnitContext: vi.fn(),
  formatCurriculumGenerationPreparation: vi.fn(),
}));

vi.mock('@/lib/server/curriculum-kb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/curriculum-kb')>()),
  curriculumCatalog: mocks.curriculumCatalog,
  curriculumUnitContext: mocks.curriculumUnitContext,
  formatCurriculumGenerationPreparation: mocks.formatCurriculumGenerationPreparation,
}));

import { GET as catalogGet } from '@/app/api/curriculum/catalog/route';
import { POST as preparePost } from '@/app/api/curriculum/prepare/route';
import { CurriculumKbError } from '@/lib/server/curriculum-kb';

function prepareRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/curriculum/prepare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const requestBody = {
  courseId: 'course-11-math',
  unitId: 'unit-3',
  audience: 'student',
  supportProfile: 'autism',
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('curriculum catalog route', () => {
  it('returns the catalog and a private cache policy', async () => {
    const catalog = { items: [], offset: 0, limit: 100, total: 0 };
    mocks.curriculumCatalog.mockResolvedValue(catalog);

    const response = await catalogGet();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    expect(await response.json()).toEqual(catalog);
  });

  it('maps a missing KB token to a service-unavailable response', async () => {
    mocks.curriculumCatalog.mockRejectedValue(
      new CurriculumKbError('not_configured', 'The curriculum knowledge base is not configured.'),
    );

    const response = await catalogGet();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'not_configured',
      error: 'The curriculum knowledge base is not configured.',
    });
  });
});

describe('curriculum preparation route', () => {
  it('prepares a usable unit and preserves the selected support profile', async () => {
    const context = {
      status: 'partial',
      primaryContent: [{ id: 'block-1', text: 'Evidence', textStatus: 'native' }],
      warnings: ['Private evaluation mode is enabled'],
    };
    const prepared = {
      requirement: 'Generate the lesson',
      warnings: context.warnings,
      status: context.status,
      skillIds: ['k12-core-literacy-planning', 'learner-support-autism'],
    };
    mocks.curriculumUnitContext.mockResolvedValue(context);
    mocks.formatCurriculumGenerationPreparation.mockReturnValue(prepared);

    const response = await preparePost(prepareRequest(requestBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(prepared);
    expect(mocks.curriculumUnitContext).toHaveBeenCalledWith('course-11-math', 'unit-3');
    expect(mocks.formatCurriculumGenerationPreparation).toHaveBeenCalledWith(context, requestBody);
  });

  it('rejects a unit without usable primary content before generation', async () => {
    mocks.curriculumUnitContext.mockResolvedValue({
      status: 'not_available',
      primaryContent: [],
      warnings: ['No textbook block is available'],
    });

    const response = await preparePost(prepareRequest(requestBody));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: 'unit_not_available',
      error: 'This unit does not have usable primary textbook content yet.',
      warnings: ['No textbook block is available'],
    });
    expect(mocks.formatCurriculumGenerationPreparation).not.toHaveBeenCalled();
  });

  it('returns a 400 for invalid JSON and invalid request fields', async () => {
    const invalidJson = new NextRequest('http://localhost/api/curriculum/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    const invalidJsonResponse = await preparePost(invalidJson);
    expect(invalidJsonResponse.status).toBe(400);
    expect(await invalidJsonResponse.json()).toEqual({
      code: 'invalid_request',
      error: 'Invalid JSON body',
    });

    const invalidFieldsResponse = await preparePost(
      prepareRequest({ ...requestBody, supportProfile: 'diagnosis' }),
    );
    expect(invalidFieldsResponse.status).toBe(400);
    expect(await invalidFieldsResponse.json()).toEqual({
      code: 'invalid_request',
      error: 'supportProfile is invalid',
    });
  });
});
