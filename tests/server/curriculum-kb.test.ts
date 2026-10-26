import { describe, expect, it } from 'vitest';

import {
  formatCurriculumGenerationPreparation,
  type CurriculumGenerationRequest,
  type CurriculumUnitContext,
} from '@/lib/server/curriculum-kb';

const context: CurriculumUnitContext = {
  schemaVersion: 1,
  bundleId: 'bundle-fixture',
  status: 'partial',
  course: {
    courseId: 'course-11-math',
    country: 'KW',
    curriculum: 'kuwait-public',
    academicYear: '2026/2027',
    grade: 11,
    track: 'scientific',
    subject: 'mathematics',
    semester: 1,
    edition: 'Fixture edition',
    language: 'ar',
  },
  unit: { id: 'unit-3', title: 'Unit 3', order: 3 },
  lessons: [{ id: 'lesson-1', title: 'Lesson 1', order: 1, objectives: ['Explain the method'] }],
  primaryContent: [
    {
      id: 'block-1',
      text: 'Source-grounded mathematics content.',
      textStatus: 'native',
      citation: { title: 'Mathematics student book', kind: 'student_book', page: 22 },
    },
  ],
  supportingMaterial: [],
  warnings: ['Private evaluation mode is enabled'],
  pagination: { offset: 0, nextOffset: null, totalBlocks: 1, truncated: false },
};

function request(
  supportProfile: CurriculumGenerationRequest['supportProfile'],
): CurriculumGenerationRequest {
  return {
    courseId: 'course-11-math',
    unitId: 'unit-3',
    audience: 'student',
    supportProfile,
  };
}

describe('curriculum lesson preparation', () => {
  it('keeps the selected curriculum scope and source evidence in the generation requirement', () => {
    const prepared = formatCurriculumGenerationPreparation(context, request('none'));

    expect(prepared.requirement).toContain('grade 11');
    expect(prepared.requirement).toContain('Unit 3');
    expect(prepared.requirement).toContain('Source-grounded mathematics content.');
    expect(prepared.requirement).toContain('enough scenes to teach the selected content');
    expect(prepared.requirement).toContain('existing animated classroom pipeline');
    expect(prepared.warnings).toContain('Private evaluation mode is enabled');
    expect(prepared.skillIds).toEqual(['k12-core-literacy-planning']);
  });

  it('keeps supplementary evidence and extracted visual guidance in the prompt', () => {
    const prepared = formatCurriculumGenerationPreparation(
      {
        ...context,
        supportingMaterial: [
          {
            id: 'support-1',
            text: 'Worked example from the workbook.',
            textStatus: 'native',
            lessonId: 'lesson-1',
            citation: { title: 'Workbook', kind: 'workbook', page: 5 },
          },
        ],
        visuals: [
          {
            id: 'visual-1',
            page: 22,
            kind: 'diagram',
            caption: 'A labelled triangle',
            purpose: 'Use it to compare the sides.',
            assetPath: '/v1/assets/visual-1',
          },
        ],
      },
      request('none'),
    );

    expect(prepared.requirement).toContain('Worked example from the workbook.');
    expect(prepared.requirement).toContain('A labelled triangle');
    expect(prepared.visuals).toEqual([
      {
        id: 'visual-1',
        assetPath: '/v1/assets/visual-1',
        page: 22,
        kind: 'diagram',
        caption: 'A labelled triangle',
      },
    ]);
  });

  it('adds only the selected learner-support skill and keeps the adaptation non-diagnostic', () => {
    const prepared = formatCurriculumGenerationPreparation(context, request('autism'));

    expect(prepared.skillIds).toEqual(['k12-core-literacy-planning', 'learner-support-autism']);
    expect(prepared.requirement).toContain('Do not infer or claim a diagnosis');
    expect(prepared.requirement).toContain('predictable structure');
  });

  it('keeps a selected lesson scoped inside the selected unit', () => {
    const prepared = formatCurriculumGenerationPreparation(context, {
      ...request('none'),
      lessonId: 'lesson-1',
    });

    expect(prepared.requirement).toContain('Selected lesson: Lesson 1');
    expect(prepared.requirement).toContain('Focus the lesson on this selected lesson');
    expect(prepared.requirement).toContain('Source-grounded mathematics content.');
  });
});
